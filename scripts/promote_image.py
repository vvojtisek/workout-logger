"""Update the production image digest, source commit, and build metadata as
one change -- the same APP_VERSION/GIT_COMMIT/BUILD_TIME trio computed by
scripts/generate_build_info.py and baked into the image, so values-prod.yaml
always agrees with what the running container reports."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

DIGEST_PATTERN = re.compile(r"sha256:[0-9a-f]{64}\Z")
COMMIT_PATTERN = re.compile(r"[0-9a-f]{40}\Z")


def replace_scalar_value(contents: str, indent: str, key: str, value: str) -> str:
    pattern = re.compile(rf"(?m)^({re.escape(indent)}{re.escape(key)}:)\s*.*$")
    updated, replacements = pattern.subn(rf'\1 "{value}"', contents)
    if replacements != 1:
        raise ValueError(f"expected exactly one {key} value, found {replacements}")
    return updated


def promote(
    values_path: Path,
    digest: str,
    commit: str,
    app_version: str,
    build_time: str,
) -> None:
    if not DIGEST_PATTERN.fullmatch(digest):
        raise ValueError("digest must be sha256 followed by 64 lowercase hexadecimal characters")
    if not COMMIT_PATTERN.fullmatch(commit):
        raise ValueError("commit must be a full 40-character lowercase hexadecimal Git SHA")

    contents = values_path.read_text()
    contents = replace_scalar_value(contents, "  ", "digest", digest)
    contents = replace_scalar_value(contents, "  ", "sourceCommit", commit)
    contents = replace_scalar_value(contents, "  ", "APP_VERSION", app_version)
    contents = replace_scalar_value(contents, "  ", "GIT_COMMIT", commit)
    contents = replace_scalar_value(contents, "  ", "BUILD_TIME", build_time)
    values_path.write_text(contents)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--values", type=Path, required=True)
    parser.add_argument("--digest", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--app-version", required=True)
    parser.add_argument("--build-time", required=True)
    args = parser.parse_args()

    promote(args.values, args.digest, args.commit, args.app_version, args.build_time)


if __name__ == "__main__":
    main()
