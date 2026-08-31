"""Unit tests for Snapshot & Backup Manager (addon.app.snapshots)."""

import json
import os
import shutil
import sys
import time
import pytest
from pathlib import Path

# Add app to path for import
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "app")))

from security import SecurityException
from snapshots import (
    create_snapshot,
    list_snapshots,
    restore_snapshot,
    _normalize_path_for_filename,
)


@pytest.fixture
def config_dir(tmp_path):
    """Create a temporary mock Home Assistant config directory."""
    config = tmp_path / "config"
    config.mkdir()

    # Create safe sample files
    (config / "automations.yaml").write_text("automation: \n  - alias: Test\n", encoding="utf-8")
    (config / "scripts.yaml").write_text("script: {}\n", encoding="utf-8")
    (config / "configuration.yaml").write_text("homeassistant:\n  name: Home\n", encoding="utf-8")

    # Create sensitive files for security checks
    (config / "secrets.yaml").write_text("wifi_pass: 123456\n", encoding="utf-8")

    # Create subfolder with file
    sub = config / "custom_components" / "test_comp"
    sub.mkdir(parents=True)
    (sub / "sensor.py").write_text("# sensor code\n", encoding="utf-8")

    return config


class TestNormalizePath:
    """Test helper for generating safe filename tokens from relative paths."""

    def test_simple_filename(self):
        assert _normalize_path_for_filename("automations.yaml") == "automations_yaml"

    def test_nested_path(self):
        assert _normalize_path_for_filename("custom_components/test_comp/sensor.py") == "custom_components_test_comp_sensor_py"

    def test_windows_separators(self):
        assert _normalize_path_for_filename(r"custom_components\test_comp\sensor.py") == "custom_components_test_comp_sensor_py"


class TestCreateSnapshot:
    """Test creating snapshots for existing and non-existing files."""

    def test_create_snapshot_existing_file(self, config_dir):
        config_root = str(config_dir)
        snap = create_snapshot(config_root, "automations.yaml", label="test backup")

        assert snap["snapshot_id"] is not None
        assert snap["original_relative_path"] == "automations.yaml"
        assert snap["label"] == "test backup"
        assert snap["is_new_file"] is False
        assert snap["size_bytes"] == os.path.getsize(config_dir / "automations.yaml")
        assert "created_at" in snap
        assert snap["backup_filename"].endswith(".bak")

        # Verify files on disk in .snapshots/
        snapshots_dir = config_dir / ".snapshots"
        assert snapshots_dir.exists()

        bak_file = snapshots_dir / snap["backup_filename"]
        assert bak_file.exists()
        assert bak_file.read_text(encoding="utf-8") == "automation: \n  - alias: Test\n"

        json_file = snapshots_dir / f"{snap['snapshot_id']}.json"
        assert json_file.exists()
        metadata = json.loads(json_file.read_text(encoding="utf-8"))
        assert metadata["snapshot_id"] == snap["snapshot_id"]
        assert metadata["original_relative_path"] == "automations.yaml"
        assert metadata["label"] == "test backup"
        assert metadata["is_new_file"] is False

    def test_create_snapshot_nested_file(self, config_dir):
        config_root = str(config_dir)
        snap = create_snapshot(config_root, "custom_components/test_comp/sensor.py", label="nested test")

        assert snap["original_relative_path"] == "custom_components/test_comp/sensor.py"
        assert "custom_components_test_comp_sensor_py" in snap["snapshot_id"]
        assert snap["is_new_file"] is False

        snapshots_dir = config_dir / ".snapshots"
        bak_file = snapshots_dir / snap["backup_filename"]
        assert bak_file.exists()
        assert bak_file.read_text(encoding="utf-8") == "# sensor code\n"

    def test_create_snapshot_non_existent_file(self, config_dir):
        config_root = str(config_dir)
        snap = create_snapshot(config_root, "new_file.yaml", label="brand new")

        assert snap["is_new_file"] is True
        assert snap["size_bytes"] == 0
        assert snap["original_relative_path"] == "new_file.yaml"

        snapshots_dir = config_dir / ".snapshots"
        assert snapshots_dir.exists()
        json_file = snapshots_dir / f"{snap['snapshot_id']}.json"
        assert json_file.exists()
        metadata = json.loads(json_file.read_text(encoding="utf-8"))
        assert metadata["is_new_file"] is True

    def test_create_snapshot_security_violation_raises(self, config_dir):
        config_root = str(config_dir)

        # Deny-list file
        with pytest.raises(SecurityException, match=r"secrets\.yaml|deny|pattern"):
            create_snapshot(config_root, "secrets.yaml")

        # Path traversal
        with pytest.raises(SecurityException, match=r"traversal|outside"):
            create_snapshot(config_root, "../../etc/shadow")

        # Null byte injection
        with pytest.raises(SecurityException, match=r"null byte|invalid"):
            create_snapshot(config_root, "automations.yaml\0.txt")


class TestListSnapshots:
    """Test listing and sorting snapshots."""

    def test_list_empty_when_no_snapshots_dir(self, config_dir):
        config_root = str(config_dir)
        snapshots = list_snapshots(config_root)
        assert snapshots == []

    def test_list_snapshots_sorted_newest_first(self, config_dir):
        config_root = str(config_dir)

        snap1 = create_snapshot(config_root, "automations.yaml", label="first")
        time.sleep(0.02)
        snap2 = create_snapshot(config_root, "scripts.yaml", label="second")
        time.sleep(0.02)
        snap3 = create_snapshot(config_root, "configuration.yaml", label="third")

        snapshots = list_snapshots(config_root)
        assert len(snapshots) == 3

        # Should be ordered newest to oldest
        assert snapshots[0]["snapshot_id"] == snap3["snapshot_id"]
        assert snapshots[1]["snapshot_id"] == snap2["snapshot_id"]
        assert snapshots[2]["snapshot_id"] == snap1["snapshot_id"]

    def test_list_snapshots_handles_corrupt_files_gracefully(self, config_dir):
        config_root = str(config_dir)
        create_snapshot(config_root, "automations.yaml", label="valid")

        # Create a corrupted JSON file in .snapshots
        corrupted = config_dir / ".snapshots" / "corrupted_file.json"
        corrupted.write_text("{invalid_json: true", encoding="utf-8")

        snapshots = list_snapshots(config_root)
        assert len(snapshots) == 1
        assert snapshots[0]["label"] == "valid"


class TestRestoreSnapshot:
    """Test restoring / rolling back files from snapshots."""

    def test_restore_existing_file_by_id(self, config_dir):
        config_root = str(config_dir)
        auto_file = config_dir / "automations.yaml"

        # Initial state
        initial_content = "automation: \n  - alias: Original State\n"
        auto_file.write_text(initial_content, encoding="utf-8")

        snap = create_snapshot(config_root, "automations.yaml", label="original")

        # Modify file
        modified_content = "automation: \n  - alias: Broken State\n"
        auto_file.write_text(modified_content, encoding="utf-8")
        assert auto_file.read_text(encoding="utf-8") == modified_content

        # Restore
        result = restore_snapshot(config_root, snap["snapshot_id"])

        assert result["success"] is True
        assert result["restored_file"] == "automations.yaml"
        assert result["restored_from"] == snap["snapshot_id"]
        assert result["safety_backup"] is not None

        # Verify file content is restored
        assert auto_file.read_text(encoding="utf-8") == initial_content

        # Verify safety backup has the modified content
        snapshots = list_snapshots(config_root)
        safety_snap = next(s for s in snapshots if s["snapshot_id"] == result["safety_backup"])
        assert safety_snap["label"] == "pre-restore-safety-backup"
        safety_bak = config_dir / ".snapshots" / safety_snap["backup_filename"]
        assert safety_bak.read_text(encoding="utf-8") == modified_content

    def test_restore_existing_file_by_filename(self, config_dir):
        config_root = str(config_dir)
        auto_file = config_dir / "automations.yaml"

        initial_content = "automation: \n  - alias: Initial\n"
        auto_file.write_text(initial_content, encoding="utf-8")
        snap = create_snapshot(config_root, "automations.yaml")

        auto_file.write_text("automation: \n  - alias: Modified\n", encoding="utf-8")

        # Restore using the .bak filename
        result = restore_snapshot(config_root, snap["backup_filename"])
        assert result["success"] is True
        assert auto_file.read_text(encoding="utf-8") == initial_content

    def test_restore_new_file_removes_file(self, config_dir):
        config_root = str(config_dir)
        new_file = config_dir / "brand_new_automation.yaml"
        assert not new_file.exists()

        # Snapshot before file is created
        snap = create_snapshot(config_root, "brand_new_automation.yaml", label="before creation")
        assert snap["is_new_file"] is True

        # Now create the file
        new_file.write_text("alias: New Automation\n", encoding="utf-8")
        assert new_file.exists()

        # Restore snapshot -> should remove the newly created file
        result = restore_snapshot(config_root, snap["snapshot_id"])
        assert result["success"] is True
        assert not new_file.exists()

    def test_restore_missing_snapshot_raises(self, config_dir):
        config_root = str(config_dir)
        with pytest.raises(FileNotFoundError, match=r"not found"):
            restore_snapshot(config_root, "20260831_000000_non_existent_12345678")

    def test_restore_security_traversal_in_snapshot_id_raises(self, config_dir):
        config_root = str(config_dir)

        with pytest.raises(SecurityException, match=r"Invalid snapshot ID|traversal"):
            restore_snapshot(config_root, "../../../etc/passwd")

        with pytest.raises(SecurityException, match=r"Invalid snapshot ID|traversal"):
            restore_snapshot(config_root, "subdir/snapshot.bak")

        with pytest.raises(SecurityException, match=r"Invalid snapshot ID|traversal"):
            restore_snapshot(config_root, "snap\0.bak")

    def test_restore_corrupted_metadata_deny_list_raises(self, config_dir):
        config_root = str(config_dir)
        snapshots_dir = config_dir / ".snapshots"
        snapshots_dir.mkdir(exist_ok=True)

        fake_id = "20260831_120000_fake_12345678"
        fake_json = snapshots_dir / f"{fake_id}.json"
        fake_bak = snapshots_dir / f"{fake_id}.bak"

        fake_bak.write_text("evil secrets", encoding="utf-8")
        fake_json.write_text(json.dumps({
            "snapshot_id": fake_id,
            "original_relative_path": "secrets.yaml",
            "created_at": "2026-08-31T12:00:00Z",
            "size_bytes": 12,
            "label": "malicious",
            "is_new_file": False,
            "backup_filename": f"{fake_id}.bak"
        }), encoding="utf-8")

        with pytest.raises(SecurityException, match=r"secrets\.yaml|deny|pattern"):
            restore_snapshot(config_root, fake_id)

    def test_restore_by_json_filename(self, config_dir):
        config_root = str(config_dir)
        auto_file = config_dir / "automations.yaml"
        initial_content = "automation: \n  - alias: Json Test\n"
        auto_file.write_text(initial_content, encoding="utf-8")
        snap = create_snapshot(config_root, "automations.yaml")

        auto_file.write_text("automation: \n  - alias: Changed\n", encoding="utf-8")
        result = restore_snapshot(config_root, f"{snap['snapshot_id']}.json")
        assert result["success"] is True
        assert auto_file.read_text(encoding="utf-8") == initial_content

    def test_restore_when_target_file_was_deleted(self, config_dir):
        config_root = str(config_dir)
        auto_file = config_dir / "automations.yaml"
        initial_content = "automation: \n  - alias: Deleted File Test\n"
        auto_file.write_text(initial_content, encoding="utf-8")
        snap = create_snapshot(config_root, "automations.yaml")

        # Delete the file entirely
        auto_file.unlink()
        assert not auto_file.exists()

        result = restore_snapshot(config_root, snap["snapshot_id"])
        assert result["success"] is True
        assert auto_file.exists()
        assert auto_file.read_text(encoding="utf-8") == initial_content

    def test_restore_nested_subfolder_creates_directories(self, config_dir):
        config_root = str(config_dir)
        sub_file = config_dir / "custom_components" / "test_comp" / "sensor.py"
        initial_content = "# sensor v1\n"
        sub_file.write_text(initial_content, encoding="utf-8")

        snap = create_snapshot(config_root, "custom_components/test_comp/sensor.py")

        # Remove the directory and file
        shutil.rmtree(config_dir / "custom_components")
        assert not sub_file.exists()

        result = restore_snapshot(config_root, snap["snapshot_id"])
        assert result["success"] is True
        assert sub_file.exists()
        assert sub_file.read_text(encoding="utf-8") == initial_content

    def test_restore_missing_bak_file_raises(self, config_dir):
        config_root = str(config_dir)
        auto_file = config_dir / "automations.yaml"
        snap = create_snapshot(config_root, "automations.yaml")

        # Delete the .bak file
        bak_file = config_dir / ".snapshots" / snap["backup_filename"]
        bak_file.unlink()

        with pytest.raises(FileNotFoundError, match=r"Backup data file.*not found"):
            restore_snapshot(config_root, snap["snapshot_id"])

