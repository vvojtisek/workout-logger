from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_VALUES = ROOT / "helm" / "workout-logger" / "values-prod.yaml"
PROMOTION_SCRIPT = ROOT / "scripts" / "promote_image.py"
VERIFICATION_SCRIPT = ROOT / "scripts" / "verify_deployment_image.py"
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"


def production_image_value(key: str) -> str:
    match = re.search(
        rf'(?m)^  {re.escape(key)}:\s*["\']?([^"\'\s]+)', PRODUCTION_VALUES.read_text()
    )
    assert match is not None
    return match.group(1)


def test_production_chart_renders_immutable_image_and_source_metadata() -> None:
    promoted_digest = production_image_value("digest")
    promoted_commit = production_image_value("sourceCommit")
    result = subprocess.run(
        [
            "helm",
            "template",
            "workout-logger",
            str(ROOT / "helm" / "workout-logger"),
            "-f",
            str(PRODUCTION_VALUES),
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    assert re.fullmatch(r"sha256:[0-9a-f]{64}", promoted_digest)
    assert re.fullmatch(r"[0-9a-f]{40}", promoted_commit)
    assert 'tag: ""' in PRODUCTION_VALUES.read_text()
    assert f"ghcr.io/vvojtisek/workout-logger@{promoted_digest}" in result.stdout
    assert f'workout-logger.vvojtisek.eu/source-commit: "{promoted_commit}"' in result.stdout
    assert f'workout-logger.vvojtisek.eu/image-digest: "{promoted_digest}"' in result.stdout
    assert "feat-v2-initial-setup" not in result.stdout


def test_promotion_script_updates_digest_and_commit_together(tmp_path: Path) -> None:
    values = tmp_path / "values-prod.yaml"
    values.write_text(PRODUCTION_VALUES.read_text())
    new_digest = "sha256:" + "a" * 64
    new_commit = "b" * 40

    subprocess.run(
        [
            sys.executable,
            str(PROMOTION_SCRIPT),
            "--values",
            str(values),
            "--digest",
            new_digest,
            "--commit",
            new_commit,
        ],
        check=True,
    )

    promoted = values.read_text()
    assert f'digest: "{new_digest}"' in promoted
    assert f'sourceCommit: "{new_commit}"' in promoted
    assert "feat-v2-initial-setup" not in promoted

    rendered = subprocess.run(
        [
            "helm",
            "template",
            "workout-logger",
            str(ROOT / "helm" / "workout-logger"),
            "-f",
            str(values),
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    assert f"ghcr.io/vvojtisek/workout-logger@{new_digest}" in rendered
    assert f'workout-logger.vvojtisek.eu/source-commit: "{new_commit}"' in rendered


def test_promotion_script_rejects_non_digest_without_changing_values(tmp_path: Path) -> None:
    values = tmp_path / "values-prod.yaml"
    original = PRODUCTION_VALUES.read_text()
    values.write_text(original)

    result = subprocess.run(
        [
            sys.executable,
            str(PROMOTION_SCRIPT),
            "--values",
            str(values),
            "--digest",
            "latest",
            "--commit",
            "b" * 40,
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert values.read_text() == original


def test_deployment_verifier_reports_matching_runtime_image(tmp_path: Path) -> None:
    promoted_digest = production_image_value("digest")
    promoted_commit = production_image_value("sourceCommit")
    expected_image = f"ghcr.io/vvojtisek/workout-logger@{promoted_digest}"
    pod = {
        "items": [
            {
                "metadata": {
                    "name": "workout-logger-test",
                    "annotations": {
                        "workout-logger.vvojtisek.eu/source-commit": promoted_commit,
                        "workout-logger.vvojtisek.eu/image-digest": promoted_digest,
                    },
                },
                "spec": {"containers": [{"image": expected_image}]},
                "status": {
                    "containerStatuses": [{"imageID": expected_image}],
                },
            }
        ]
    }
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    kubectl = fake_bin / "kubectl"
    kubectl.write_text(f"#!/bin/sh\nprintf '%s' '{json.dumps(pod)}'\n")
    kubectl.chmod(0o755)
    env = os.environ | {"PATH": f"{fake_bin}:{os.environ['PATH']}"}

    result = subprocess.run(
        [
            sys.executable,
            str(VERIFICATION_SCRIPT),
            "--values",
            str(PRODUCTION_VALUES),
            "--namespace",
            "test",
            "--selector",
            "app=workout-logger",
        ],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )

    assert f"Git commit: {promoted_commit}" in result.stdout
    assert f"Image digest: {promoted_digest}" in result.stdout
    assert f"imageID={expected_image}" in result.stdout


def test_ci_publishes_only_main_sha_and_promotes_through_protected_branch() -> None:
    workflow = WORKFLOW.read_text()

    assert "ghcr.io/${{ github.repository }}:${{ github.sha }}" in workflow
    assert "cancel-in-progress: false" in workflow
    assert "!contains(github.event.head_commit.message, '[skip image publish]')" in workflow
    assert workflow.count("[skip image publish]") >= 3
    assert "push: true" in workflow
    assert "scripts/promote_image.py" in workflow
    assert 'git push --force-with-lease --set-upstream origin "$promotion_branch"' in workflow
    assert "gh pr create" in workflow
    assert 'gh workflow run ci.yml --ref "$PROMOTION_BRANCH"' in workflow
    assert 'gh run watch "$promotion_run_id" --exit-status' in workflow
    assert 'gh pr merge "$PROMOTION_PR" --squash --delete-branch' in workflow
    assert "git push origin HEAD:main" not in workflow
    assert "type=ref,event=branch" not in workflow
    assert "type=raw,value=latest" not in workflow
