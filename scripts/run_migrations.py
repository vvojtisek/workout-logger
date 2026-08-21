"""Run one Alembic migration per release and retain its output on the data volume."""

from __future__ import annotations

import argparse
import fcntl
import os
import re
import subprocess
from pathlib import Path


RELEASE_ID_PATTERN = re.compile(r"[0-9a-f]{12}")


def _record(log_file, message: str) -> None:
    print(message, end="" if message.endswith("\n") else "\n", flush=True)
    with log_file.open("a") as output:
        output.write(message)
        if not message.endswith("\n"):
            output.write("\n")


def run_migration(release_id: str, revision: str, state_dir: Path) -> int:
    if not RELEASE_ID_PATTERN.fullmatch(release_id):
        raise ValueError("release ID must be exactly 12 lowercase hexadecimal characters")

    state_dir.mkdir(parents=True, exist_ok=True)
    log_file = state_dir / f"{release_id}.log"
    success_marker = state_dir / f"{release_id}.succeeded"
    lock_file = state_dir / f"{release_id}.lock"

    with lock_file.open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if success_marker.exists():
            _record(log_file, f"[migration] release {release_id} already completed; skipping")
            return 0

        _record(log_file, f"[migration] release {release_id}: alembic upgrade {revision}")
        result = subprocess.run(
            ["alembic", "upgrade", revision],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        if result.stdout:
            _record(log_file, result.stdout)

        if result.returncode != 0:
            _record(log_file, f"[migration] release {release_id} failed")
            return result.returncode

        temporary_marker = state_dir / f".{release_id}.succeeded-{os.getpid()}"
        temporary_marker.write_text(f"revision={revision}\n")
        temporary_marker.replace(success_marker)
        _record(log_file, f"[migration] release {release_id} completed")
        return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("revision", nargs="?", default="head")
    parser.add_argument(
        "--release-id",
        default=os.environ.get("MIGRATION_RELEASE_ID"),
        required="MIGRATION_RELEASE_ID" not in os.environ,
    )
    parser.add_argument(
        "--state-dir",
        type=Path,
        default=Path(os.environ.get("MIGRATION_STATE_DIR", "/data/migration-releases")),
    )
    args = parser.parse_args()
    raise SystemExit(run_migration(args.release_id, args.revision, args.state_dir))


if __name__ == "__main__":
    main()
