"""Validate and atomically restore a SQLite backup with exclusive access."""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

from backup_database import (
    BackupValidationError,
    _database_facts,
    _fsync_directory,
    _fsync_file,
    validate_backup,
)


def restore_database(
    backup_path: Path,
    destination: Path,
    *,
    exclusive_access: bool,
) -> None:
    if not exclusive_access:
        raise PermissionError(
            "Restore requires exclusive database access; scale the application to zero first"
        )
    if backup_path.resolve() == destination.resolve():
        raise ValueError("Backup and restore destination must be different files")

    metadata = validate_backup(backup_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        prefix=f".{destination.name}.", suffix=".restore.tmp", dir=destination.parent, delete=False
    ) as temporary:
        temporary_path = Path(temporary.name)

    try:
        source_conn = sqlite3.connect(f"{backup_path.resolve().as_uri()}?mode=ro", uri=True)
        dest_conn = sqlite3.connect(str(temporary_path))
        try:
            source_conn.backup(dest_conn)
        finally:
            dest_conn.close()
            source_conn.close()

        schema_revision, _ = _database_facts(temporary_path)
        if schema_revision != metadata["schema_revision"]:
            raise BackupValidationError("Restored schema revision does not match metadata")
        _fsync_file(temporary_path)

        for suffix in ("-wal", "-shm"):
            destination.with_name(f"{destination.name}{suffix}").unlink(missing_ok=True)
        os.replace(temporary_path, destination)
        _fsync_directory(destination.parent)
    finally:
        temporary_path.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup", type=Path, required=True)
    parser.add_argument("--destination", type=Path, default=Path("/data/workout_logger.db"))
    parser.add_argument(
        "--confirm-exclusive-access",
        action="store_true",
        help="Confirm all application database writers have been stopped",
    )
    args = parser.parse_args()

    try:
        restore_database(
            args.backup,
            args.destination,
            exclusive_access=args.confirm_exclusive_access,
        )
    except (BackupValidationError, FileNotFoundError, PermissionError, ValueError) as exc:
        print(f"Restore failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    print(f"Verified backup restored to {args.destination}")


if __name__ == "__main__":
    main()
