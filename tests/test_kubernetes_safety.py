from __future__ import annotations

import subprocess
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
CHART = ROOT / "helm" / "workout-logger"
PRODUCTION_VALUES = CHART / "values-prod.yaml"
ENTRYPOINT = ROOT / "scripts" / "entrypoint.sh"

BOUNDED_RESOURCES = {
    "requests": {"cpu": "50m", "memory": "64Mi"},
    "limits": {"cpu": "250m", "memory": "256Mi"},
}


def render_production_chart(*extra_args: str) -> str:
    return subprocess.run(
        [
            "helm",
            "template",
            "workout-logger",
            str(CHART),
            "-f",
            str(PRODUCTION_VALUES),
            *extra_args,
        ],
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


def test_maintenance_jobs_have_bounded_resources_on_the_small_production_host() -> None:
    # The host has 2Gi RAM and no swap (see issue #72). Every maintenance job
    # (migration, backup, restore) must carry an explicit, bounded resources
    # block, well under the app Deployment's own 512Mi limit, so none of them
    # can add unbounded memory pressure on top of it during a rollout.
    documents = [doc for doc in yaml.safe_load_all(render_production_chart()) if doc]
    migration_job = next(
        doc for doc in documents if doc["kind"] == "Job" and "-migrate-" in doc["metadata"]["name"]
    )
    backup_cronjob = next(doc for doc in documents if doc["kind"] == "CronJob")

    assert (
        migration_job["spec"]["template"]["spec"]["containers"][0]["resources"] == BOUNDED_RESOURCES
    )
    assert (
        backup_cronjob["spec"]["jobTemplate"]["spec"]["template"]["spec"]["containers"][0][
            "resources"
        ]
        == BOUNDED_RESOURCES
    )

    # restore.enabled is false by default (it's an on-demand break-glass
    # operation), so its resources block only shows up on a render that
    # actually turns it on.
    restore_documents = [
        doc
        for doc in yaml.safe_load_all(
            render_production_chart(
                "--set",
                "restore.enabled=true",
                "--set",
                "restore.backupFile=workout_logger-20260821T120000Z.db",
                "--set",
                "replicaCount=0",
                "--set",
                "migrationJob.enabled=false",
            )
        )
        if doc
    ]
    restore_job = next(
        doc
        for doc in restore_documents
        if doc["kind"] == "Job" and "-restore-" in doc["metadata"]["name"]
    )
    assert (
        restore_job["spec"]["template"]["spec"]["containers"][0]["resources"] == BOUNDED_RESOURCES
    )


def test_termination_budget_allows_graceful_shutdown() -> None:
    rendered = render_production_chart()

    assert "terminationGracePeriodSeconds: 60" in rendered
    assert "lifecycle:" in rendered
    assert "preStop:" in rendered
    assert "- /bin/sh" in rendered
    assert "- -c" in rendered
    assert "- sleep 5" in rendered
    assert "--timeout-graceful-shutdown 50" in ENTRYPOINT.read_text()
