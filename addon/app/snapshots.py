"""Atomic Pre-Edit Snapshot & Rollback Manager for HA Addon."""

import datetime
import json
import os
import pathlib
import re
import shutil
import tempfile
import uuid

try:
    from .security import sanitize_path, SecurityException
except ImportError:
    from security import sanitize_path, SecurityException


def _normalize_path_for_filename(relative_path: str) -> str:
    """Convert a relative path into a safe filename-compatible string.

    Replaces path separators and special characters with underscores.

    Args:
        relative_path: Relative path string (e.g. 'custom_components/comp/sensor.py').

    Returns:
        str: Normalized alphanumeric string suitable for filenames.
    """
    posix_path = pathlib.Path(relative_path).as_posix()
    normalized = re.sub(r"[^a-zA-Z0-9]", "_", posix_path)
    # Strip leading/trailing underscores if any
    return normalized.strip("_") or "root"


def create_snapshot(config_root: str, relative_path: str, label: str = "") -> dict:
    """Create an atomic pre-edit snapshot of a file or record a new-file marker.

    Validates path security via sanitize_path, stores a timestamped .bak file in
    <config_root>/.snapshots/, and writes a JSON metadata sidecar file.

    Args:
        config_root: Absolute or relative root directory of HA configuration.
        relative_path: Path of the target file relative to config_root.
        label: Optional description or label for the snapshot.

    Returns:
        dict: Metadata dictionary representing the created snapshot.

    Raises:
        SecurityException: If target path violates path containment or deny-list rules.
    """
    target_path = sanitize_path(config_root, relative_path)
    canonical_root = os.path.realpath(os.path.abspath(config_root))
    snapshots_dir = os.path.join(canonical_root, ".snapshots")
    os.makedirs(snapshots_dir, exist_ok=True)

    now = datetime.datetime.now(datetime.timezone.utc)
    timestamp_str = now.strftime("%Y%m%d_%H%M%S")
    iso_created_at = now.isoformat()
    uuid8 = uuid.uuid4().hex[:8]
    normalized_rel = _normalize_path_for_filename(relative_path)

    snapshot_id = f"{timestamp_str}_{normalized_rel}_{uuid8}"
    backup_filename = f"{snapshot_id}.bak"
    bak_path = os.path.join(snapshots_dir, backup_filename)
    json_path = os.path.join(snapshots_dir, f"{snapshot_id}.json")

    rel_posix = pathlib.Path(os.path.relpath(target_path, canonical_root)).as_posix()

    is_existing = os.path.exists(target_path) and os.path.isfile(target_path)
    if is_existing:
        size_bytes = os.path.getsize(target_path)
        is_new_file = False

        # Copy atomically to .snapshots
        temp_bak = tempfile.NamedTemporaryFile(dir=snapshots_dir, delete=False)
        temp_bak.close()
        try:
            shutil.copy2(target_path, temp_bak.name)
            os.replace(temp_bak.name, bak_path)
        except Exception:
            if os.path.exists(temp_bak.name):
                os.remove(temp_bak.name)
            raise
    else:
        size_bytes = 0
        is_new_file = True
        # Create empty .bak file placeholder
        with open(bak_path, "wb") as f:
            pass

    metadata = {
        "snapshot_id": snapshot_id,
        "original_relative_path": rel_posix,
        "created_at": iso_created_at,
        "size_bytes": size_bytes,
        "label": label,
        "is_new_file": is_new_file,
        "backup_filename": backup_filename,
    }

    # Write metadata JSON sidecar atomically
    temp_json = tempfile.NamedTemporaryFile(mode="w", dir=snapshots_dir, delete=False, encoding="utf-8")
    try:
        json.dump(metadata, temp_json, indent=2)
        temp_json.flush()
        temp_json.close()
        os.replace(temp_json.name, json_path)
    except Exception:
        if os.path.exists(temp_json.name):
            os.remove(temp_json.name)
        raise

    return metadata


def list_snapshots(config_root: str) -> list[dict]:
    """List all available snapshots in <config_root>/.snapshots/ sorted newest first.

    Args:
        config_root: Root directory of HA configuration.

    Returns:
        list[dict]: List of snapshot metadata dictionaries sorted descending by creation time.
    """
    canonical_root = os.path.realpath(os.path.abspath(config_root))
    snapshots_dir = os.path.join(canonical_root, ".snapshots")

    if not os.path.exists(snapshots_dir) or not os.path.isdir(snapshots_dir):
        return []

    snapshots = []
    try:
        filenames = os.listdir(snapshots_dir)
    except OSError:
        return []

    for filename in filenames:
        if not filename.endswith(".json"):
            continue
        file_path = os.path.join(snapshots_dir, filename)
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and "snapshot_id" in data:
                snapshots.append(data)
        except Exception:
            # Gracefully ignore any corrupted or unreadable JSON files
            continue

    snapshots.sort(key=lambda s: s.get("created_at", s.get("snapshot_id", "")), reverse=True)
    return snapshots


def restore_snapshot(config_root: str, snapshot_id_or_filename: str) -> dict:
    """Restore a file from a snapshot or rollback a newly created file.

    Takes a safety snapshot of current state before restoration and replaces the
    target file atomically.

    Args:
        config_root: Root directory of HA configuration.
        snapshot_id_or_filename: Snapshot ID (e.g. '20260831_120000_automations_yaml_a1b2c3d4')
            or backup filename ('20260831_120000_automations_yaml_a1b2c3d4.bak').

    Returns:
        dict: Summary of restore operation including safety backup reference.

    Raises:
        SecurityException: If snapshot ID contains directory traversal or target file violates policy.
        FileNotFoundError: If snapshot metadata or backup file does not exist.
    """
    if not snapshot_id_or_filename or not isinstance(snapshot_id_or_filename, str):
        raise SecurityException("Invalid snapshot ID: must be a non-empty string")

    if "\0" in snapshot_id_or_filename or "/" in snapshot_id_or_filename or "\\" in snapshot_id_or_filename or ".." in snapshot_id_or_filename:
        raise SecurityException(
            f"Invalid snapshot ID '{snapshot_id_or_filename}': path traversal or illegal characters detected"
        )

    clean_id = snapshot_id_or_filename
    if clean_id.endswith(".bak"):
        clean_id = clean_id[:-4]
    elif clean_id.endswith(".json"):
        clean_id = clean_id[:-5]

    if not re.match(r"^[a-zA-Z0-9_\-]+$", clean_id):
        raise SecurityException(f"Invalid snapshot ID '{snapshot_id_or_filename}': illegal characters detected")

    canonical_root = os.path.realpath(os.path.abspath(config_root))
    snapshots_dir = os.path.join(canonical_root, ".snapshots")
    metadata_path = os.path.join(snapshots_dir, f"{clean_id}.json")
    bak_path = os.path.join(snapshots_dir, f"{clean_id}.bak")

    if not os.path.isfile(metadata_path):
        raise FileNotFoundError(f"Snapshot '{snapshot_id_or_filename}' not found.")

    try:
        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)
    except Exception as err:
        raise FileNotFoundError(f"Failed to read snapshot metadata: {err}")

    original_rel_path = metadata.get("original_relative_path")
    if not original_rel_path:
        raise SecurityException("Corrupted snapshot metadata: missing original_relative_path")

    is_new_file = metadata.get("is_new_file", False)

    # Security check on target path
    target_path = sanitize_path(config_root, original_rel_path)

    # Take safety snapshot before restoring
    safety_backup = create_snapshot(
        config_root,
        original_rel_path,
        label="pre-restore-safety-backup",
    )

    if is_new_file:
        # File did not exist when snapshot was taken; delete it if it exists now
        if os.path.exists(target_path):
            os.remove(target_path)
    else:
        if not os.path.isfile(bak_path):
            raise FileNotFoundError(f"Backup data file '{bak_path}' not found for snapshot '{clean_id}'.")
        target_dir = os.path.dirname(target_path)
        os.makedirs(target_dir, exist_ok=True)

        temp_target = tempfile.NamedTemporaryFile(dir=target_dir, delete=False)
        temp_target.close()
        try:
            shutil.copy2(bak_path, temp_target.name)
            os.replace(temp_target.name, target_path)
        except Exception:
            if os.path.exists(temp_target.name):
                os.remove(temp_target.name)
            raise

    return {
        "success": True,
        "restored_file": original_rel_path,
        "restored_from": snapshot_id_or_filename,
        "safety_backup": safety_backup["snapshot_id"],
    }
