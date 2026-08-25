"""Reads the deployment metadata baked into the image by the Dockerfile.

`build_info.json` is written at image-build time from the same
scripts/generate_build_info.py output that CI also writes into the Helm
values used to deploy that image (see helm/workout-logger/values-prod.yaml
and scripts/promote_image.py) -- so this file's contents are the fallback
`Settings` defaults, overridden by the `APP_VERSION`/`GIT_COMMIT`/
`BUILD_TIME` environment variables Helm sets on the container.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

_BUILD_INFO_PATH = Path(__file__).resolve().parent.parent / "build_info.json"


@dataclass(frozen=True)
class BuildInfo:
    version: str
    commit: str
    build_time: str


@lru_cache
def get_build_info() -> BuildInfo:
    try:
        data = json.loads(_BUILD_INFO_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        data = {}
    return BuildInfo(
        version=data.get("version") or "dev",
        commit=data.get("commit") or "unknown",
        build_time=data.get("build_time") or "unknown",
    )
