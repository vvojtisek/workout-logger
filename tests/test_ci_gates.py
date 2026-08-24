from __future__ import annotations

import json
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
FAST_WORKFLOW = WORKFLOWS / "ci-fast.yml"
MERGE_WORKFLOW = WORKFLOWS / "ci-merge.yml"
SECURITY_WORKFLOW = WORKFLOWS / "ci-security.yml"
PACKAGE = ROOT / "package.json"
E2E = ROOT / "e2e" / "workout.spec.js"


def fast_workflow() -> dict:
    return yaml.safe_load(FAST_WORKFLOW.read_text())


def merge_workflow() -> dict:
    return yaml.safe_load(MERGE_WORKFLOW.read_text())


def test_ci_runs_required_parallel_gates_on_pull_requests_and_main() -> None:
    fast = fast_workflow()
    fast_triggers = fast[True]
    assert "pull_request" in fast_triggers
    assert {"backend", "frontend", "manifests"} <= set(fast["jobs"])

    merge = merge_workflow()
    merge_triggers = merge[True]
    assert merge_triggers["push"]["branches"] == ["main"]
    assert {"e2e", "publish"} <= set(merge["jobs"])


def test_untrusted_pull_requests_cannot_publish_or_promote() -> None:
    publish = merge_workflow()["jobs"]["publish"]

    assert set(publish["needs"]) == {"e2e"}
    assert "!contains(github.event.head_commit.message, '[skip image publish]')" in publish["if"]


def test_manifest_and_security_gates_have_explicit_thresholds() -> None:
    fast_text = FAST_WORKFLOW.read_text()
    security_text = SECURITY_WORKFLOW.read_text()

    assert "kubeconform" in fast_text
    assert "-kubernetes-version 1.35.0" in fast_text
    assert "pip-audit" in security_text
    assert "npm audit --audit-level=high" in security_text
    assert "gitleaks" in security_text
    assert "trivy" in security_text
    assert "CRITICAL,HIGH" in security_text
    assert "syft" in security_text


def test_frontend_commands_and_real_browser_journey_are_configured() -> None:
    package = json.loads(PACKAGE.read_text())
    scripts = package["scripts"]

    assert {"lint", "typecheck", "test", "build", "test:e2e"} <= set(scripts)
    e2e = E2E.read_text()
    assert "TEST_RUN_ID" in e2e
    assert "request.post" in e2e
    assert "request.get" in e2e
    assert "request.put" in e2e
    assert "request.delete" in e2e
    assert "finally" in e2e


def test_e2e_uses_real_kubernetes_image_database_and_failure_artifacts() -> None:
    text = MERGE_WORKFLOW.read_text()
    e2e_job = merge_workflow()["jobs"]["e2e"]
    step_text = yaml.safe_dump(e2e_job)

    assert "k3d cluster create" in step_text
    assert "docker build" in step_text
    assert "alembic" in text
    assert "npm run test:e2e" in step_text
    assert "if: always()" in step_text
    assert "actions/upload-artifact" in step_text
    assert "k3d cluster delete" in step_text