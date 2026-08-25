"""Compute the deployment build metadata (APP_VERSION, GIT_COMMIT, BUILD_TIME).

This is the single source of truth for the version/commit/build-time trio
that CI threads through the whole deployment chain: it is passed as Docker
build args (baked into the image as `build_info.json` and OCI labels),
written into the Helm values that describe production, and from there
becomes the application's environment -- surfaced by `/health`, the
`X-App-Version`/`X-Git-Commit`/`X-Build-Time` response headers, and the web
UI. Nothing downstream recomputes these values independently.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def _run_git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def resolve_git_commit() -> str:
    return _run_git("rev-parse", "HEAD")


def resolve_app_version() -> str:
    """Prefer a Git tag/release name; otherwise fall back to a deterministic,
    automatically generated version derived from the repository history."""
    try:
        return _run_git("describe", "--tags", "--always", "--dirty")
    except subprocess.CalledProcessError:
        return resolve_git_commit()[:12]


def resolve_build_time() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_info() -> dict[str, str]:
    return {
        "version": resolve_app_version(),
        "commit": resolve_git_commit(),
        "build_time": resolve_build_time(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--format",
        choices=["json", "env", "github"],
        default="json",
        help="json: {version,commit,build_time} object. "
        "env: APP_VERSION=/GIT_COMMIT=/BUILD_TIME= lines. "
        "github: same as env, suitable for $GITHUB_OUTPUT/$GITHUB_ENV.",
    )
    parser.add_argument("--output", type=Path, help="Write to this path instead of stdout")
    args = parser.parse_args()

    info = build_info()
    if args.format == "json":
        rendered = json.dumps(info, indent=2) + "\n"
    else:
        rendered = (
            f"APP_VERSION={info['version']}\n"
            f"GIT_COMMIT={info['commit']}\n"
            f"BUILD_TIME={info['build_time']}\n"
        )

    if args.output:
        args.output.write_text(rendered)
    else:
        print(rendered, end="")


if __name__ == "__main__":
    main()
