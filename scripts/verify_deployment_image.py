"""Verify that running Kubernetes Pods match the production Git promotion."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path
from typing import Any


def image_value(contents: str, key: str) -> str:
    match = re.search(rf'(?m)^  {re.escape(key)}:\s*["\']?([^"\'\s]+)', contents)
    if not match:
        raise ValueError(f"could not read image.{key} from production values")
    return match.group(1)


def load_pods(namespace: str, selector: str) -> list[dict[str, Any]]:
    result = subprocess.run(
        ["kubectl", "get", "pods", "-n", namespace, "-l", selector, "-o", "json"],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout)
    return payload["items"]


def verify(values: Path, namespace: str, selector: str) -> None:
    contents = values.read_text()
    repository = image_value(contents, "repository")
    digest = image_value(contents, "digest")
    commit = image_value(contents, "sourceCommit")
    expected_image = f"{repository}@{digest}"
    pods = load_pods(namespace, selector)
    if not pods:
        raise RuntimeError(f"no Pods found in {namespace!r} for selector {selector!r}")

    print(f"Git commit: {commit}")
    print(f"Image digest: {digest}")
    for pod in pods:
        name = pod["metadata"]["name"]
        annotations = pod["metadata"].get("annotations", {})
        requested_image = pod["spec"]["containers"][0]["image"]
        statuses = pod.get("status", {}).get("containerStatuses", [])
        image_id = statuses[0].get("imageID", "") if statuses else ""
        print(f"Pod {name}: requested={requested_image} imageID={image_id}")

        if annotations.get("workout-logger.vvojtisek.eu/source-commit") != commit:
            raise RuntimeError(f"Pod {name} source commit annotation does not match Git")
        if annotations.get("workout-logger.vvojtisek.eu/image-digest") != digest:
            raise RuntimeError(f"Pod {name} image digest annotation does not match Git")
        if requested_image != expected_image:
            raise RuntimeError(f"Pod {name} requested image does not match Git")
        if not image_id.endswith(f"@{digest}"):
            raise RuntimeError(f"Pod {name} runtime image ID does not match Git")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--values", type=Path, required=True)
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--selector", required=True)
    args = parser.parse_args()
    verify(args.values, args.namespace, args.selector)


if __name__ == "__main__":
    main()
