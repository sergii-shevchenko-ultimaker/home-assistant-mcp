"""Snapshot module re-exports for backward compatibility."""

try:
    from .services.snapshot_service import (
        SNAPSHOTS_DIR_NAME,
        SnapshotService,
        _normalize_path_for_filename,
        create_snapshot,
        get_snapshots_dir,
        list_snapshots,
        restore_snapshot,
    )
except (ImportError, ValueError):
    try:
        from app.services.snapshot_service import (
            SNAPSHOTS_DIR_NAME,
            SnapshotService,
            _normalize_path_for_filename,
            create_snapshot,
            get_snapshots_dir,
            list_snapshots,
            restore_snapshot,
        )
    except (ImportError, ValueError):
        from services.snapshot_service import (
            SNAPSHOTS_DIR_NAME,
            SnapshotService,
            _normalize_path_for_filename,
            create_snapshot,
            get_snapshots_dir,
            list_snapshots,
            restore_snapshot,
        )

__all__ = [
    "SNAPSHOTS_DIR_NAME",
    "SnapshotService",
    "_normalize_path_for_filename",
    "create_snapshot",
    "get_snapshots_dir",
    "list_snapshots",
    "restore_snapshot",
]
