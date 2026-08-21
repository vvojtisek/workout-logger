from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
STAGING_VALUES = ROOT / "helm" / "workout-logger" / "values-staging.yaml"
STAGING_APPLICATION = ROOT / "deploy" / "argocd" / "application-staging.yaml"
RELEASE_STATE = ROOT / "environments" / "staging" / "release-state.json"
ROLLBACK_SCRIPT = ROOT / "scripts" / "rollback_release.py"
ROLLBACK_WORKFLOW = ROOT / ".github" / "workflows" / "rollback-drill.yml"


def test_staging_is_a_separate_gitops_application() -> None:
    application = yaml.safe_load(STAGING_APPLICATION.read_text())

    assert application["metadata"]["name"] == "workout-logger-staging"
    assert application["spec"]["source"]["targetRevision"] == "main"
    assert application["spec"]["source"]["helm"]["valueFiles"] == [
        "values.yaml",
        "values-staging.yaml",
    ]
    assert application["spec"]["source"]["helm"]["releaseName"] == "workout-logger"
    assert application["spec"]["destination"]["namespace"] == "staging"
    assert application["spec"]["syncPolicy"]["automated"] == {
        "prune": True,
        "selfHeal": True,
    }


def test_staging_values_and_lkg_state_pin_the_same_immutable_release() -> None:
    values = yaml.safe_load(STAGING_VALUES.read_text())
    state = json.loads(RELEASE_STATE.read_text())
    stable = state["lastKnownGood"]

    assert state["schemaVersion"] == 1
    assert state["environment"] == "staging"
    assert values["image"]["digest"] == stable["imageDigest"]
    assert values["image"]["sourceCommit"] == stable["sourceCommit"]
    assert values["image"]["tag"] == ""
    assert values["ingress"]["hosts"][0]["host"] == "staging.workout-logger.local"


def test_rollback_restores_lkg_digest_and_commit_together(tmp_path: Path) -> None:
    values = tmp_path / "values-staging.yaml"
    values.write_text(STAGING_VALUES.read_text())
    state = tmp_path / "release-state.json"
    state.write_text(RELEASE_STATE.read_text())
    original = yaml.safe_load(values.read_text())
    original["image"]["digest"] = "sha256:" + "f" * 64
    original["image"]["sourceCommit"] = "e" * 40
    values.write_text(yaml.safe_dump(original, sort_keys=False))

    result = subprocess.run(
        [
            sys.executable,
            str(ROLLBACK_SCRIPT),
            "--values",
            str(values),
            "--state",
            str(state),
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    restored = yaml.safe_load(values.read_text())
    stable = json.loads(state.read_text())["lastKnownGood"]
    assert restored["image"]["digest"] == stable["imageDigest"]
    assert restored["image"]["sourceCommit"] == stable["sourceCommit"]
    assert "Rolled staging back" in result.stdout


def test_rollback_rejects_invalid_lkg_without_changing_values(tmp_path: Path) -> None:
    values = tmp_path / "values-staging.yaml"
    values.write_text(STAGING_VALUES.read_text())
    original = values.read_text()
    state = tmp_path / "release-state.json"
    state.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "environment": "staging",
                "lastKnownGood": {"imageDigest": "latest", "sourceCommit": "bad"},
            }
        )
    )

    result = subprocess.run(
        [
            sys.executable,
            str(ROLLBACK_SCRIPT),
            "--values",
            str(values),
            "--state",
            str(state),
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert values.read_text() == original


def test_ci_runs_a_real_ephemeral_argocd_rollback_drill() -> None:
    workflow = yaml.safe_load(ROLLBACK_WORKFLOW.read_text())
    workflow_text = ROLLBACK_WORKFLOW.read_text()

    assert "pull_request" in workflow[True]
    assert "workflow_dispatch" in workflow[True]
    assert "k3d cluster create" in workflow_text
    assert "argoproj/argo-cd" in workflow_text
    assert "scripts/run_rollback_drill.py" in workflow_text
    assert "if: always()" in workflow_text
    assert "actions/upload-artifact" in workflow_text
    assert "docker push" not in workflow_text


@pytest.mark.parametrize("path", [STAGING_VALUES, STAGING_APPLICATION])
def test_staging_manifests_are_renderable(path: Path) -> None:
    assert path.exists()
