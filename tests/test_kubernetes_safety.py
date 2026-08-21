from __future__ import annotations

import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHART = ROOT / "helm" / "workout-logger"
PRODUCTION_VALUES = CHART / "values-prod.yaml"
ENTRYPOINT = ROOT / "scripts" / "entrypoint.sh"


def render_production_chart() -> str:
    return subprocess.run(
        ["helm", "template", "workout-logger", str(CHART), "-f", str(PRODUCTION_VALUES)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def test_sqlite_deployment_uses_single_replica_recreate_strategy() -> None:
    rendered = render_production_chart()

    assert "  replicas: 1\n" in rendered
    assert "  strategy:\n    type: Recreate\n" in rendered
    assert "maxSurge" not in rendered


def test_probes_separate_process_liveness_from_database_readiness() -> None:
    rendered = render_production_chart()

    assert "path: /health/startup" in rendered
    assert "failureThreshold: 150" in rendered
    assert "path: /health/live" in rendered
    assert "path: /health/ready" in rendered
    assert rendered.index("startupProbe:") < rendered.index("livenessProbe:")


def test_termination_budget_allows_graceful_shutdown() -> None:
    rendered = render_production_chart()

    assert "terminationGracePeriodSeconds: 60" in rendered
    assert "lifecycle:" in rendered
    assert "preStop:" in rendered
    assert "- /bin/sh" in rendered
    assert "- -c" in rendered
    assert "- sleep 5" in rendered
    assert "--timeout-graceful-shutdown 50" in ENTRYPOINT.read_text()
