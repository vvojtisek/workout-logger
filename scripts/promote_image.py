"""Update the production image digest and its source commit as one change."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

DIGEST_PATTERN = re.compile(r"sha256:[0-9a-f]{64}\Z")
COMMIT_PATTERN = re.compile(r"[0-9a-f]{40}\Z")


def replace_image_value(contents: str, key: str, value: str) -> str:
    pattern = re.compile(rf"(?m)^(  {re.escape(key)}:)\s*.*$")
    updated, replacements = pattern.subn(rf'\1 "{value}"', contents)
    if replacements != 1:
        raise ValueError(f"expected exactly one image.{key} value, found {replacements}")
    return updated


def promote(values_path: Path, digest: str, commit: str) -> None:
    if not DIGEST_PATTERN.fullmatch(digest):
        raise ValueError("digest must be sha256 followed by 64 lowercase hexadecimal characters")
    if not COMMIT_PATTERN.fullmatch(commit):
        raise ValueError("commit must be a full 40-character lowercase hexadecimal Git SHA")

    contents = values_path.read_text()
    contents = replace_image_value(contents, "digest", digest)
    contents = replace_image_value(contents, "sourceCommit", commit)
    values_path.write_text(contents)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--values", type=Path, required=True)
    parser.add_argument("--digest", required=True)
    parser.add_argument("--commit", required=True)
    args = parser.parse_args()

    promote(args.values, args.digest, args.commit)


if __name__ == "__main__":
    main()
