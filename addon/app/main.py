"""FastAPI Server for Home Assistant AI Helper Addon."""

import json
import os
import tempfile
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query, status
from pydantic import BaseModel
import yaml

try:
    from .security import SecurityException, sanitize_log_line, sanitize_path, verify_api_key
    from .snapshots import create_snapshot, list_snapshots, restore_snapshot
except ImportError:
    try:
        from app.security import SecurityException, sanitize_log_line, sanitize_path, verify_api_key
        from app.snapshots import create_snapshot, list_snapshots, restore_snapshot
    except ImportError:
        from security import SecurityException, sanitize_log_line, sanitize_path, verify_api_key
        from snapshots import create_snapshot, list_snapshots, restore_snapshot


def get_config_root() -> str:
    """Retrieve the configured Home Assistant configuration root directory."""
    return os.environ.get("CONFIG_ROOT", "/config")


def get_api_key() -> str:
    """Retrieve the configured Addon API Key from environment or options.json."""
    env_key = os.environ.get("ADDON_API_KEY", "")
    if env_key:
        return env_key
    options_path = "/data/options.json"
    if os.path.isfile(options_path):
        try:
            with open(options_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return str(data.get("api_key", ""))
        except Exception:
            pass
    return ""


def verify_token(
    x_addon_api_key: str | None = Header(default=None, alias="X-Addon-API-Key"),
    expected_key: str = Depends(get_api_key),
) -> None:
    """Validate X-Addon-API-Key header using constant-time comparison."""
    if not x_addon_api_key or not verify_api_key(x_addon_api_key, expected_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Addon-API-Key header",
        )


app = FastAPI(
    title="Home Assistant AI Helper Addon",
    description="Lightweight and secure AI agent companion for Home Assistant",
    version="1.0.0",
)

api_v1 = APIRouter(prefix="/api/v1", dependencies=[Depends(verify_token)])


# ---------------------------------------------------------------------------
# Request & Response Models
# ---------------------------------------------------------------------------

class FileReadRequest(BaseModel):
    path: str


class FileReadResponse(BaseModel):
    path: str
    content: str
    size_bytes: int


class FileWriteRequest(BaseModel):
    path: str
    content: str
    validate_yaml: bool = True
    label: str = ""


class FileWriteResponse(BaseModel):
    success: bool
    path: str
    snapshot_id: str
    bytes_written: int


class BackupRestoreRequest(BaseModel):
    snapshot_id: str


class BackupRestoreResponse(BaseModel):
    success: bool
    restored_file: str
    restored_from: str
    safety_backup: str


class HealthResponse(BaseModel):
    status: str
    version: str
    config_root: str
    snapshots_count: int
    memory_mb: float


class LogsTailResponse(BaseModel):
    lines: list[str]
    count: int


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@api_v1.get("/health", response_model=HealthResponse)
def get_health(config_root: str = Depends(get_config_root)) -> dict[str, Any]:
    """Return addon health status, snapshots count, and current memory usage."""
    memory_mb = 0.0
    try:
        import psutil
        process = psutil.Process()
        memory_mb = round(process.memory_info().rss / (1024 * 1024), 2)
    except Exception:
        memory_mb = 0.0

    snapshots = list_snapshots(config_root)
    return {
        "status": "ok",
        "version": "1.0.0",
        "config_root": config_root,
        "snapshots_count": len(snapshots),
        "memory_mb": memory_mb,
    }


@api_v1.post("/file/read", response_model=FileReadResponse)
def read_file(
    req: FileReadRequest,
    config_root: str = Depends(get_config_root),
) -> dict[str, Any]:
    """Read file content safely within the configuration jail."""
    try:
        target_path = sanitize_path(config_root, req.path)
    except SecurityException as err:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(err))

    if not os.path.exists(target_path) or not os.path.isfile(target_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File not found: {req.path}",
        )

    try:
        with open(target_path, "r", encoding="utf-8", newline="") as f:
            content = f.read()
        size_bytes = len(content.encode("utf-8"))
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read file: {err}",
        )

    return {
        "path": req.path,
        "content": content,
        "size_bytes": size_bytes,
    }


@api_v1.post("/file/write", response_model=FileWriteResponse)
def write_file(
    req: FileWriteRequest,
    config_root: str = Depends(get_config_root),
) -> dict[str, Any]:
    """Atomically write file with pre-edit snapshot and optional YAML validation."""
    # 1. Validate YAML syntax if requested
    if req.validate_yaml and req.path.lower().endswith((".yaml", ".yml")):
        try:
            yaml.safe_load(req.content)
        except yaml.YAMLError as err:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid YAML syntax: {err}",
            )

    # 2. Path sanitization check
    try:
        target_path = sanitize_path(config_root, req.path)
    except SecurityException as err:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(err))

    # 3. Create pre-edit snapshot
    try:
        snapshot_meta = create_snapshot(config_root, req.path, label=req.label)
    except SecurityException as err:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(err))
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create pre-edit snapshot: {err}",
        )

    # 4. Atomic file write
    target_dir = os.path.dirname(target_path)
    os.makedirs(target_dir, exist_ok=True)

    temp_file = tempfile.NamedTemporaryFile(
        mode="w",
        dir=target_dir,
        delete=False,
        encoding="utf-8",
        newline="",
    )
    try:
        temp_file.write(req.content)
        temp_file.flush()
        temp_file.close()
        os.replace(temp_file.name, target_path)
    except Exception as err:
        if os.path.exists(temp_file.name):
            os.remove(temp_file.name)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to write file: {err}",
        )

    bytes_written = len(req.content.encode("utf-8"))
    return {
        "success": True,
        "path": req.path,
        "snapshot_id": snapshot_meta["snapshot_id"],
        "bytes_written": bytes_written,
    }


@api_v1.get("/backup/list", response_model=list[dict[str, Any]])
def list_backups(config_root: str = Depends(get_config_root)) -> list[dict[str, Any]]:
    """List all available file snapshots sorted newest first."""
    return list_snapshots(config_root)


@api_v1.post("/backup/restore", response_model=BackupRestoreResponse)
def restore_backup(
    req: BackupRestoreRequest,
    config_root: str = Depends(get_config_root),
) -> dict[str, Any]:
    """Restore a file from a snapshot or rollback a newly created file."""
    try:
        result = restore_snapshot(config_root, req.snapshot_id)
        return result
    except SecurityException as err:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(err))
    except FileNotFoundError as err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err))
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to restore snapshot: {err}",
        )


@api_v1.get("/logs/tail", response_model=LogsTailResponse)
def tail_logs(
    lines: int = Query(default=100, ge=1, le=1000),
    config_root: str = Depends(get_config_root),
) -> dict[str, Any]:
    """Tail and sanitize recent lines from home-assistant.log."""
    log_file = os.path.join(config_root, "home-assistant.log")
    if not os.path.isfile(log_file):
        return {"lines": [], "count": 0}

    try:
        with open(log_file, "r", encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()
        tail_slice = all_lines[-lines:] if lines < len(all_lines) else all_lines
        sanitized = [sanitize_log_line(line.rstrip("\r\n")) for line in tail_slice]
        return {
            "lines": sanitized,
            "count": len(sanitized),
        }
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read logs: {err}",
        )


app.include_router(api_v1)
