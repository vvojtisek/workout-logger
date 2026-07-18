"""Creates a consistent SQLite backup using the sqlite3 online backup API.

Safe to run while the application is writing to the database in WAL mode,
unlike a plain file copy which could capture a torn write across the
main .db file and its -wal/-shm companions.
"""

import argparse
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_KEEP = 7


def backup_database(source: Path, dest_dir: Path, keep: int) -> Path:
    if not source.exists():
        raise FileNotFoundError(f"Source database not found: {source}")

    dest_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest_path = dest_dir / f"{source.stem}-{timestamp}.db"

    source_conn = sqlite3.connect(str(source))
    dest_conn = sqlite3.connect(str(dest_path))
    try:
        source_conn.backup(dest_conn)
    finally:
        dest_conn.close()
        source_conn.close()

    _prune_old_backups(dest_dir, source.stem, keep)
    return dest_path


def _prune_old_backups(dest_dir: Path, stem: str, keep: int) -> None:
    backups = sorted(dest_dir.glob(f"{stem}-*.db"), key=lambda p: p.name, reverse=True)
    for stale in backups[keep:]:
        stale.unlink()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("/data/workout_logger.db"))
    parser.add_argument("--dest-dir", type=Path, default=Path("/backups"))
    parser.add_argument("--keep", type=int, default=DEFAULT_KEEP)
    args = parser.parse_args()

    dest_path = backup_database(args.source, args.dest_dir, args.keep)
    print(f"Backup written to {dest_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
