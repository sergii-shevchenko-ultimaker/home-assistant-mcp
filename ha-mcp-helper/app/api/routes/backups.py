"""Snapshot listing and rollback restore endpoints."""

from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status

from ...core.config import get_config_root
from ...core.security import SecurityException
from ...services.snapshot_service import SnapshotService
from ..schemas import BackupRestoreRequest, BackupRestoreResponse

router = APIRouter(tags=["Backups"])


@router.get("/backup/list", response_model=list[dict[str, Any]])
def list_backups(config_root: str = Depends(get_config_root)) -> list[dict[str, Any]]:
    """List all available file snapshots, ordered newest first."""
    return SnapshotService.list_snapshots(config_root)


@router.post("/backup/restore", response_model=BackupRestoreResponse)
def restore_backup(
    req: BackupRestoreRequest,
    config_root: str = Depends(get_config_root),
) -> dict[str, Any]:
    """Restore a file from a snapshot or rollback a created file."""
    try:
        return SnapshotService.restore_snapshot(config_root, req.snapshot_id)
    except SecurityException as err:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(err))
    except FileNotFoundError as err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err))
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to restore snapshot: {err}",
        )
