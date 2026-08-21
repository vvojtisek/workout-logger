"""Restore an environment values file to its recorded last-known-good release."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from promote_image import COMMIT_PATTERN, DIGEST_PATTERN, promote


def load_last_known_good(state_path: Path) -> tuple[str, str]:
    state = json.loads(state_path.read_text(encoding="utf-8"))
    if state.get("schemaVersion") != 1 or state.get("environment") != "staging":
        raise ValueError("unsupported staging release-state format")
    stable = state.get("lastKnownGood", {})
    digest = stable.get("imageDigest", "")
    commit = stable.get("sourceCommit", "")
    if not DIGEST_PATTERN.fullmatch(digest):
        raise ValueError("last-known-good image digest is invalid")
    if not COMMIT_PATTERN.fullmatch(commit):
        raise ValueError("last-known-good source commit is invalid")
    return digest, commit


def rollback(values_path: Path, state_path: Path) -> tuple[str, str]:
    digest, commit = load_last_known_good(state_path)
    promote(values_path, digest, commit)
    return digest, commit


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--values", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    args = parser.parse_args()

    digest, commit = rollback(args.values, args.state)
    print(f"Rolled staging back to {commit} ({digest})")


if __name__ == "__main__":
    main()
