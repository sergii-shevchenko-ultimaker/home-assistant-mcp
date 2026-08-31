"""Snapshot creation, metadata tracking, and atomic rollback service."""

from datetime import datetime, timezone
import json
import os
import pathlib
import re
import shutil
import tempfile
import uuid
from typing import Any

from ..core.security import SecurityException, sanitize_path

SNAPSHOTS_DIR_NAME = ".snapshots"
_SAFE_FILENAME_RE = re.compile(r"^[a-zA-Z0-9_\-]+$")


def get_snapshots_dir(config_root: str) -> str:
    """Return the snapshots directory, ensuring it exists inside the configuration root."""
    snapshots_dir = os.path.join(config_root, SNAPSHOTS_DIR_NAME)
    os.makedirs(snapshots_dir, exist_ok=True)
    return snapshots_dir


def _normalize_path_for_filename(rel_path: str) -> str:
    """Convert relative path into a safe filename component."""
    normalized = rel_path.replace("\\", "/").strip("/")
    safe = re.sub(r"[^a-zA-Z0-9_]+", "_", normalized)
    return safe.strip("_") or "root"


class SnapshotService:
    """Handles atomic snapshot management and rollbacks."""

    @staticmethod
    def create_snapshot(config_root: str, relative_path: str, label: str = "") -> dict[str, Any]:
        """Create an atomic timestamped backup before modifying a file."""
        target_path = sanitize_path(config_root, relative_path)
        snapshots_dir = get_snapshots_dir(config_root)

        now = datetime.now(timezone.utc)
        timestamp_str = now.strftime("%Y%m%d_%H%M%S")
        safe_rel = _normalize_path_for_filename(relative_path)
        unique_suffix = uuid.uuid4().hex[:8]
        snapshot_id = f"snap_{timestamp_str}_{safe_rel}_{unique_suffix}"

        backup_filename = f"{snapshot_id}.bak"
        metadata_filename = f"{snapshot_id}.json"

        backup_path = os.path.join(snapshots_dir, backup_filename)
        metadata_path = os.path.join(snapshots_dir, metadata_filename)

        file_exists = os.path.exists(target_path) and os.path.isfile(target_path)
        size_bytes = 0

        if file_exists:
            size_bytes = os.path.getsize(target_path)
            temp_bak = tempfile.NamedTemporaryFile(mode="wb", dir=snapshots_dir, delete=False)
            try:
                with open(target_path, "rb") as src:
                    shutil.copyfileobj(src, temp_bak)
                temp_bak.flush()
                temp_bak.close()
                os.replace(temp_bak.name, backup_path)
            except Exception:
                if os.path.exists(temp_bak.name):
                    os.remove(temp_bak.name)
                raise
        else:
            with open(backup_path, "wb") as f:
                pass

        metadata = {
            "snapshot_id": snapshot_id,
            "original_relative_path": relative_path.replace("\\", "/"),
            "created_at": now.isoformat(),
            "size_bytes": size_bytes,
            "label": label,
            "is_new_file": not file_exists,
            "backup_filename": backup_filename,
        }

        temp_json = tempfile.NamedTemporaryFile(mode="w", dir=snapshots_dir, delete=False, encoding="utf-8")
        try:
            json.dump(metadata, temp_json, indent=2)
            temp_json.flush()
            temp_json.close()
            os.replace(temp_json.name, metadata_path)
        except Exception:
            if os.path.exists(temp_json.name):
                os.remove(temp_json.name)
            if os.path.exists(backup_path):
                os.remove(backup_path)
            raise

        return metadata

    @staticmethod
    def list_snapshots(config_root: str) -> list[dict[str, Any]]:
        """List all available snapshots, sorted newest to oldest."""
        snapshots_dir = os.path.join(config_root, SNAPSHOTS_DIR_NAME)
        if not os.path.isdir(snapshots_dir):
            return []

        results: list[dict[str, Any]] = []
        for entry in os.listdir(snapshots_dir):
            if entry.endswith(".json"):
                meta_path = os.path.join(snapshots_dir, entry)
                try:
                    with open(meta_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    if isinstance(data, dict) and "snapshot_id" in data:
                        results.append(data)
                except Exception:
                    continue

        results.sort(key=lambda s: str(s.get("created_at", "")), reverse=True)
        return results

    @staticmethod
    def restore_snapshot(config_root: str, snapshot_id_or_filename: str) -> dict[str, Any]:
        """Restore a snapshot atomically over its original target path."""
        clean_id = snapshot_id_or_filename.removesuffix(".bak").removesuffix(".json")
        if not _SAFE_FILENAME_RE.match(clean_id):
            raise SecurityException(f"Invalid snapshot ID: '{snapshot_id_or_filename}'")

        snapshots_dir = get_snapshots_dir(config_root)
        meta_file = os.path.join(snapshots_dir, f"{clean_id}.json")
        bak_file = os.path.join(snapshots_dir, f"{clean_id}.bak")

        if not os.path.isfile(meta_file):
            raise FileNotFoundError(f"Snapshot metadata not found: '{snapshot_id_or_filename}'")

        if not os.path.isfile(bak_file):
            raise FileNotFoundError(f"Backup data file ({clean_id}.bak) not found for snapshot '{snapshot_id_or_filename}'")

        with open(meta_file, "r", encoding="utf-8") as f:
            metadata = json.load(f)

        orig_rel = metadata.get("original_relative_path", "")
        if not orig_rel:
            raise SecurityException("Corrupted snapshot: missing original_relative_path")

        target_path = sanitize_path(config_root, orig_rel)
        is_new_file = bool(metadata.get("is_new_file", False))

        safety_snapshot_id = ""
        if os.path.exists(target_path) and os.path.isfile(target_path):
            safety_meta = SnapshotService.create_snapshot(
                config_root, orig_rel, label="pre-restore-safety-backup"
            )
            safety_snapshot_id = safety_meta["snapshot_id"]

        if is_new_file:
            if os.path.exists(target_path):
                os.remove(target_path)
        else:
            target_dir = os.path.dirname(target_path)
            os.makedirs(target_dir, exist_ok=True)
            temp_file = tempfile.NamedTemporaryFile(mode="wb", dir=target_dir, delete=False)
            try:
                with open(bak_file, "rb") as src:
                    shutil.copyfileobj(src, temp_file)
                temp_file.flush()
                temp_file.close()
                os.replace(temp_file.name, target_path)
            except Exception:
                if os.path.exists(temp_file.name):
                    os.remove(temp_file.name)
                raise

        return {
            "success": True,
            "restored_file": orig_rel,
            "restored_from": clean_id,
            "safety_backup": safety_snapshot_id,
        }


# Convenience function aliases
create_snapshot = SnapshotService.create_snapshot
list_snapshots = SnapshotService.list_snapshots
restore_snapshot = SnapshotService.restore_snapshot
