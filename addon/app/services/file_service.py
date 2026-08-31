"""Safe file reading and atomic writing with syntax validation and snapshots."""

import os
import tempfile
from typing import Any
import yaml

from ..core.security import SecurityException, sanitize_path
from .snapshot_service import SnapshotService


class FileService:
    """Service handling safe file reads and atomic writes inside config jail."""

    @staticmethod
    def read_file(config_root: str, relative_path: str) -> dict[str, Any]:
        """Safely read content from a file inside configuration root."""
        target_path = sanitize_path(config_root, relative_path)

        if not os.path.exists(target_path) or not os.path.isfile(target_path):
            raise FileNotFoundError(f"File not found: {relative_path}")

        with open(target_path, "r", encoding="utf-8", newline="") as f:
            content = f.read()

        return {
            "path": relative_path,
            "content": content,
            "size_bytes": len(content.encode("utf-8")),
        }

    @staticmethod
    def write_file(
        config_root: str,
        relative_path: str,
        content: str,
        validate_yaml: bool = True,
        label: str = "",
    ) -> dict[str, Any]:
        """Atomically write content to file after snapshot creation and YAML validation."""
        # 1. Validate YAML syntax if enabled
        if validate_yaml and relative_path.lower().endswith((".yaml", ".yml")):
            try:
                yaml.safe_load(content)
            except yaml.YAMLError as err:
                raise ValueError(f"Invalid YAML syntax: {err}")

        # 2. Path sanitization check
        target_path = sanitize_path(config_root, relative_path)

        # 3. Create pre-edit snapshot
        snapshot_meta = SnapshotService.create_snapshot(config_root, relative_path, label=label)

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
            temp_file.write(content)
            temp_file.flush()
            temp_file.close()
            os.replace(temp_file.name, target_path)
        except Exception:
            if os.path.exists(temp_file.name):
                os.remove(temp_file.name)
            raise

        return {
            "success": True,
            "path": relative_path,
            "snapshot_id": snapshot_meta["snapshot_id"],
            "bytes_written": len(content.encode("utf-8")),
        }
