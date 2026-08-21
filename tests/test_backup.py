import hashlib
import json
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from backup_database import (
    BackupValidationError,
    backup_database,
    validate_backup,
)
from restore_database import restore_database


def make_source_db(path: Path) -> None:
    conn = sqlite3.connect(str(path))
    conn.execute("CREATE TABLE workout_plans (id TEXT PRIMARY KEY, name TEXT)")
    conn.execute("INSERT INTO workout_plans VALUES ('1', 'Push Day')")
    conn.execute("CREATE TABLE alembic_version (version_num TEXT PRIMARY KEY)")
    conn.execute("INSERT INTO alembic_version VALUES ('93469c1ebbbf')")
    conn.commit()
    conn.close()


def create_backup(source: Path, dest_dir: Path, keep: int = 7) -> Path:
    return backup_database(
        source,
        dest_dir,
        keep=keep,
        source_release="test-release",
        source_image="example.invalid/workout-logger@sha256:abc123",
    )


def test_backup_creates_a_restorable_copy(tmp_path):
    source = tmp_path / "workout_logger.db"
    make_source_db(source)
    dest_dir = tmp_path / "backups"

    backup_path = create_backup(source, dest_dir)

    assert backup_path.exists()
    conn = sqlite3.connect(str(backup_path))
    rows = conn.execute("SELECT name FROM workout_plans").fetchall()
    conn.close()
    assert rows == [("Push Day",)]


def test_backup_is_independent_from_source_file(tmp_path):
    source = tmp_path / "workout_logger.db"
    make_source_db(source)
    dest_dir = tmp_path / "backups"

    backup_path = create_backup(source, dest_dir)

    conn = sqlite3.connect(str(source))
    conn.execute("INSERT INTO workout_plans VALUES ('2', 'Pull Day')")
    conn.commit()
    conn.close()

    backup_conn = sqlite3.connect(str(backup_path))
    rows = backup_conn.execute("SELECT name FROM workout_plans").fetchall()
    backup_conn.close()
    assert rows == [("Push Day",)]


def test_backup_prunes_old_generations_beyond_keep(tmp_path):
    source = tmp_path / "workout_logger.db"
    make_source_db(source)
    dest_dir = tmp_path / "backups"

    for _ in range(5):
        create_backup(source, dest_dir, keep=3)

    remaining = sorted(dest_dir.glob("workout_logger-*.db"))
    assert len(remaining) == 3
    assert len(list(dest_dir.glob("workout_logger-*.json"))) == 3


def test_backup_raises_when_source_missing(tmp_path):
    missing_source = tmp_path / "does_not_exist.db"
    with pytest.raises(FileNotFoundError):
        create_backup(missing_source, tmp_path / "backups", keep=3)


def test_backup_writes_verified_provenance_metadata(tmp_path: Path) -> None:
    source = tmp_path / "workout_logger.db"
    make_source_db(source)

    backup_path = create_backup(source, tmp_path / "backups")
    metadata = json.loads(backup_path.with_suffix(".json").read_text())

    assert metadata == validate_backup(backup_path)
    assert metadata["created_at"].endswith("Z")
    assert metadata["source_release"] == "test-release"
    assert metadata["source_image"] == "example.invalid/workout-logger@sha256:abc123"
    assert metadata["sha256"] == hashlib.sha256(backup_path.read_bytes()).hexdigest()
    assert metadata["schema_revision"] == "93469c1ebbbf"
    assert metadata["size_bytes"] == backup_path.stat().st_size


def test_integrity_validation_rejects_a_damaged_backup(tmp_path: Path) -> None:
    source = tmp_path / "workout_logger.db"
    make_source_db(source)
    backup_path = create_backup(source, tmp_path / "backups")
    backup_path.write_bytes(b"not a sqlite database")

    metadata_path = backup_path.with_suffix(".json")
    metadata = json.loads(metadata_path.read_text())
    metadata["sha256"] = hashlib.sha256(backup_path.read_bytes()).hexdigest()
    metadata["size_bytes"] = backup_path.stat().st_size
    metadata_path.write_text(json.dumps(metadata))

    with pytest.raises(BackupValidationError, match="integrity"):
        validate_backup(backup_path)


def test_restore_requires_explicit_exclusive_access(tmp_path: Path) -> None:
    source = tmp_path / "workout_logger.db"
    destination = tmp_path / "restored.db"
    make_source_db(source)
    make_source_db(destination)
    backup_path = create_backup(source, tmp_path / "backups")

    with pytest.raises(PermissionError, match="exclusive"):
        restore_database(backup_path, destination, exclusive_access=False)


def test_restore_rejects_damage_without_touching_destination(tmp_path: Path) -> None:
    source = tmp_path / "workout_logger.db"
    destination = tmp_path / "restored.db"
    make_source_db(source)
    make_source_db(destination)
    backup_path = create_backup(source, tmp_path / "backups")
    original_destination = destination.read_bytes()
    backup_path.write_bytes(b"damaged")

    with pytest.raises(BackupValidationError, match="size mismatch"):
        restore_database(backup_path, destination, exclusive_access=True)

    assert destination.read_bytes() == original_destination


def test_restore_validates_then_atomically_replaces_database(tmp_path: Path) -> None:
    source = tmp_path / "workout_logger.db"
    destination = tmp_path / "restored.db"
    make_source_db(source)
    make_source_db(destination)
    backup_path = create_backup(source, tmp_path / "backups")

    conn = sqlite3.connect(str(destination))
    conn.execute("DELETE FROM workout_plans")
    conn.commit()
    conn.close()
    destination.with_name(f"{destination.name}-wal").touch()
    destination.with_name(f"{destination.name}-shm").touch()

    restore_database(backup_path, destination, exclusive_access=True)

    conn = sqlite3.connect(str(destination))
    rows = conn.execute("SELECT name FROM workout_plans").fetchall()
    conn.close()
    assert rows == [("Push Day",)]
    assert not destination.with_name(f"{destination.name}-wal").exists()
    assert not destination.with_name(f"{destination.name}-shm").exists()
