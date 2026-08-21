from __future__ import annotations

import json
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
PACKAGE = ROOT / "package.json"
E2E = ROOT / "e2e" / "workout.spec.js"


def workflow() -> dict:
    return yaml.safe_load(WORKFLOW.read_text())


def test_ci_runs_required_parallel_gates_on_pull_requests_and_main() -> None:
    config = workflow()
    triggers = config[True]

    assert "pull_request" in triggers
    assert triggers["push"]["branches"] == ["main"]
    assert {"backend", "frontend", "manifests", "security", "e2e", "publish"} <= set(config["jobs"])


def test_untrusted_pull_requests_cannot_publish_or_promote() -> None:
    publish = workflow()["jobs"]["publish"]

    assert set(publish["needs"]) == {"backend", "frontend", "manifests", "security", "e2e"}
    assert "github.event_name == 'push'" in publish["if"]
    assert "github.ref == 'refs/heads/main'" in publish["if"]


def test_manifest_and_security_gates_have_explicit_thresholds() -> None:
    text = WORKFLOW.read_text()

    assert "kubeconform" in text
    assert "-kubernetes-version 1.35.0" in text
    assert "pip-audit" in text
    assert "npm audit --audit-level=high" in text
    assert "gitleaks" in text
    assert "trivy" in text
    assert "CRITICAL,HIGH" in text
    assert "syft" in text


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
    text = WORKFLOW.read_text()
    e2e_job = workflow()["jobs"]["e2e"]
    step_text = yaml.safe_dump(e2e_job)

    assert "k3d cluster create" in step_text
    assert "docker build" in step_text
    assert "alembic" in text
    assert "npm run test:e2e" in step_text
    assert "if: always()" in step_text
    assert "actions/upload-artifact" in step_text
    assert "k3d cluster delete" in step_text
