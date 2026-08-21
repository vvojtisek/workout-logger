"""Create and validate provenance-bearing SQLite backup artifacts.

The SQLite online backup API makes a transactionally consistent copy while the
application is writing in WAL mode. Each database is paired with JSON metadata
and is published only after its checksum and SQLite integrity have been checked.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

DEFAULT_KEEP = 7
BUFFER_SIZE = 1024 * 1024


class BackupValidationError(RuntimeError):
    """Raised when a backup artifact is incomplete, inconsistent, or corrupt."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(BUFFER_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _database_facts(path: Path) -> tuple[str, int]:
    try:
        connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
        try:
            integrity_rows = connection.execute("PRAGMA integrity_check").fetchall()
            if integrity_rows != [("ok",)]:
                details = "; ".join(str(row[0]) for row in integrity_rows)
                raise BackupValidationError(f"SQLite integrity check failed: {details}")
            revision_row = connection.execute("SELECT version_num FROM alembic_version").fetchone()
            if revision_row is None or not revision_row[0]:
                raise BackupValidationError("Backup has no Alembic schema revision")
            return str(revision_row[0]), path.stat().st_size
        finally:
            connection.close()
    except (sqlite3.DatabaseError, OSError) as exc:
        raise BackupValidationError(f"SQLite integrity check failed: {exc}") from exc


def _metadata_path(backup_path: Path) -> Path:
    return backup_path.with_suffix(".json")


def validate_backup(backup_path: Path) -> dict[str, Any]:
    """Validate the metadata, checksum, schema revision, and SQLite structure."""
    metadata_path = _metadata_path(backup_path)
    if not backup_path.is_file():
        raise BackupValidationError(f"Backup database not found: {backup_path}")
    if not metadata_path.is_file():
        raise BackupValidationError(f"Backup metadata not found: {metadata_path}")

    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BackupValidationError(f"Invalid backup metadata: {exc}") from exc

    required = {
        "created_at",
        "source_release",
        "source_image",
        "sha256",
        "schema_revision",
        "size_bytes",
    }
    missing = sorted(required - metadata.keys())
    if missing:
        raise BackupValidationError(f"Backup metadata is missing: {', '.join(missing)}")

    actual_size = backup_path.stat().st_size
    if metadata["size_bytes"] != actual_size:
        raise BackupValidationError(
            f"Backup size mismatch: expected {metadata['size_bytes']}, got {actual_size}"
        )
    actual_checksum = _sha256(backup_path)
    if metadata["sha256"] != actual_checksum:
        raise BackupValidationError("Backup checksum mismatch")

    schema_revision, _ = _database_facts(backup_path)
    if metadata["schema_revision"] != schema_revision:
        raise BackupValidationError("Backup schema revision does not match its metadata")
    return metadata


def _fsync_file(path: Path) -> None:
    with path.open("rb") as stream:
        os.fsync(stream.fileno())


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def backup_database(
    source: Path,
    dest_dir: Path,
    keep: int,
    *,
    source_release: str,
    source_image: str,
) -> Path:
    if not source.is_file():
        raise FileNotFoundError(f"Source database not found: {source}")
    if keep < 1:
        raise ValueError("keep must be at least 1")
    if not source_release.strip() or not source_image.strip():
        raise ValueError("source release and image are required")

    dest_dir.mkdir(parents=True, exist_ok=True)
    created_at = datetime.now(UTC)
    timestamp = created_at.strftime("%Y%m%dT%H%M%S%fZ")
    dest_path = dest_dir / f"{source.stem}-{timestamp}.db"
    metadata_path = _metadata_path(dest_path)

    with tempfile.NamedTemporaryFile(
        prefix=f".{source.stem}-", suffix=".db.tmp", dir=dest_dir, delete=False
    ) as temporary:
        temporary_path = Path(temporary.name)
    temporary_metadata = temporary_path.with_suffix(".json.tmp")

    try:
        source_conn = sqlite3.connect(f"{source.resolve().as_uri()}?mode=ro", uri=True)
        dest_conn = sqlite3.connect(str(temporary_path))
        try:
            source_conn.backup(dest_conn)
        finally:
            dest_conn.close()
            source_conn.close()

        schema_revision, size_bytes = _database_facts(temporary_path)
        metadata = {
            "created_at": created_at.isoformat(timespec="microseconds").replace("+00:00", "Z"),
            "source_release": source_release,
            "source_image": source_image,
            "sha256": _sha256(temporary_path),
            "schema_revision": schema_revision,
            "size_bytes": size_bytes,
        }
        temporary_metadata.write_text(
            json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        _fsync_file(temporary_path)
        _fsync_file(temporary_metadata)
        os.replace(temporary_path, dest_path)
        os.replace(temporary_metadata, metadata_path)
        _fsync_directory(dest_dir)
        validate_backup(dest_path)
    except Exception:
        dest_path.unlink(missing_ok=True)
        metadata_path.unlink(missing_ok=True)
        raise
    finally:
        temporary_path.unlink(missing_ok=True)
        temporary_metadata.unlink(missing_ok=True)

    _prune_old_backups(dest_dir, source.stem, keep)
    return dest_path


def _prune_old_backups(dest_dir: Path, stem: str, keep: int) -> None:
    backups = sorted(dest_dir.glob(f"{stem}-*.db"), key=lambda path: path.name, reverse=True)
    for stale in backups[keep:]:
        stale.unlink()
        _metadata_path(stale).unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("/data/workout_logger.db"))
    parser.add_argument("--dest-dir", type=Path, default=Path("/backups"))
    parser.add_argument("--keep", type=int, default=DEFAULT_KEEP)
    parser.add_argument("--source-release", required=True)
    parser.add_argument("--source-image", required=True)
    args = parser.parse_args()

    try:
        dest_path = backup_database(
            args.source,
            args.dest_dir,
            args.keep,
            source_release=args.source_release,
            source_image=args.source_image,
        )
    except (BackupValidationError, FileNotFoundError, ValueError) as exc:
        print(f"Backup failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    print(f"Verified backup written to {dest_path}")


if __name__ == "__main__":
    main()
