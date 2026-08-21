"""Validate a SQLite backup artifact without restoring it."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from backup_database import BackupValidationError, validate_backup


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    args = parser.parse_args()

    try:
        metadata = validate_backup(args.backup)
    except BackupValidationError as exc:
        print(f"Backup validation failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    print(json.dumps(metadata, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
