import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from backup_database import backup_database  # noqa: E402


def make_source_db(path: Path) -> None:
    conn = sqlite3.connect(str(path))
    conn.execute("CREATE TABLE workout_plans (id TEXT PRIMARY KEY, name TEXT)")
    conn.execute("INSERT INTO workout_plans VALUES ('1', 'Push Day')")
    conn.commit()
    conn.close()


def test_backup_creates_a_restorable_copy(tmp_path):
    source = tmp_path / "workout_logger.db"
    make_source_db(source)
    dest_dir = tmp_path / "backups"

    backup_path = backup_database(source, dest_dir, keep=7)

    assert backup_path.exists()
    conn = sqlite3.connect(str(backup_path))
    rows = conn.execute("SELECT name FROM workout_plans").fetchall()
    conn.close()
    assert rows == [("Push Day",)]


def test_backup_is_independent_from_source_file(tmp_path):
    source = tmp_path / "workout_logger.db"
    make_source_db(source)
    dest_dir = tmp_path / "backups"

    backup_path = backup_database(source, dest_dir, keep=7)

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
        backup_database(source, dest_dir, keep=3)
        time.sleep(1.1)  # ensure distinct second-resolution timestamps

    remaining = sorted(dest_dir.glob("workout_logger-*.db"))
    assert len(remaining) == 3


def test_backup_raises_when_source_missing(tmp_path):
    import pytest

    missing_source = tmp_path / "does_not_exist.db"
    with pytest.raises(FileNotFoundError):
        backup_database(missing_source, tmp_path / "backups", keep=3)
