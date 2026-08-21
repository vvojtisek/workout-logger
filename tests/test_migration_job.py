from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

import yaml


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


def rendered_resource(kind: str) -> dict:
    resources = yaml.safe_load_all(render_production_chart())
    return next(resource for resource in resources if resource and resource.get("kind") == kind)


def test_migration_job_is_a_bounded_presync_hook() -> None:
    rendered = render_production_chart()

    assert "kind: Job" in rendered
    assert "argocd.argoproj.io/hook: PreSync" in rendered
    assert "argocd.argoproj.io/hook-delete-policy" not in rendered
    assert "activeDeadlineSeconds: 300" in rendered
    assert "backoffLimit: 1" in rendered
    assert "restartPolicy: Never" in rendered
    assert "HookSucceeded" not in rendered
    assert "ttlSecondsAfterFinished" not in rendered


def test_migration_job_uses_release_image_database_and_pvc() -> None:
    rendered = render_production_chart()
    production_values = yaml.safe_load(PRODUCTION_VALUES.read_text())
    production_image = (
        f"{production_values['image']['repository']}@{production_values['image']['digest']}"
    )
    migration_identity = f'{production_image}|["python","/app/scripts/run_migrations.py"]|["head"]'
    migration_id = hashlib.sha256(migration_identity.encode()).hexdigest()[:12]

    deployment_image = rendered_resource("Deployment")["spec"]["template"]["spec"]["containers"][0][
        "image"
    ]
    migration_image = rendered_resource("Job")["spec"]["template"]["spec"]["containers"][0]["image"]
    assert deployment_image == production_image
    assert migration_image == production_image
    assert f"name: workout-logger-migrate-{migration_id}" in rendered
    assert (
        "command:\n            - python\n            - /app/scripts/run_migrations.py" in rendered
    )
    assert "args:\n            - head" in rendered
    assert "name: MIGRATION_RELEASE_ID" in rendered
    assert f'value: "{migration_id}"' in rendered
    assert "claimName: workout-logger-data" in rendered
    assert "mountPath: /data" in rendered


def test_production_application_startup_skips_independent_migration() -> None:
    rendered = render_production_chart()
    entrypoint = ENTRYPOINT.read_text()

    assert "name: RUN_MIGRATIONS_ON_STARTUP" in rendered
    assert 'value: "false"' in rendered
    assert "RUN_MIGRATIONS_ON_STARTUP" in entrypoint
    assert "alembic upgrade head" in entrypoint
    assert "Skipping database migrations" in entrypoint


def test_service_selector_excludes_migration_job_pods() -> None:
    service_selector = rendered_resource("Service")["spec"]["selector"]
    migration_labels = rendered_resource("Job")["spec"]["template"]["metadata"]["labels"]

    assert not (service_selector.items() <= migration_labels.items())
    assert service_selector["app.kubernetes.io/component"] == "web"
    assert migration_labels["app.kubernetes.io/component"] == "migration"


def test_web_component_does_not_change_immutable_deployment_selector() -> None:
    deployment = rendered_resource("Deployment")
    deployment_selector = deployment["spec"]["selector"]["matchLabels"]
    pod_labels = deployment["spec"]["template"]["metadata"]["labels"]

    assert "app.kubernetes.io/component" not in deployment_selector
    assert pod_labels["app.kubernetes.io/component"] == "web"
    assert deployment_selector.items() <= pod_labels.items()
