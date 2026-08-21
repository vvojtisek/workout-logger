from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
CHART = ROOT / "helm" / "workout-logger"


def render_chart(*set_values: str) -> list[dict]:
    command = ["helm", "template", "workout-logger", str(CHART)]
    for value in set_values:
        command.extend(["--set", value])
    rendered = subprocess.run(command, check=True, capture_output=True, text=True).stdout
    return [resource for resource in yaml.safe_load_all(rendered) if resource]


def resource(resources: list[dict], kind: str) -> dict:
    return next(item for item in resources if item["kind"] == kind)


def test_scheduled_backup_uses_a_separate_retained_pvc() -> None:
    resources = render_chart("backup.enabled=true")
    pvcs = [item for item in resources if item["kind"] == "PersistentVolumeClaim"]
    cronjob = resource(resources, "CronJob")
    pod_spec = cronjob["spec"]["jobTemplate"]["spec"]["template"]["spec"]

    assert {pvc["metadata"]["name"] for pvc in pvcs} == {
        "workout-logger-data",
        "workout-logger-backups",
    }
    backup_pvc = next(pvc for pvc in pvcs if pvc["metadata"]["name"].endswith("-backups"))
    assert "Prune=false" in backup_pvc["metadata"]["annotations"]["argocd.argoproj.io/sync-options"]
    claims = {
        volume["name"]: volume["persistentVolumeClaim"]["claimName"]
        for volume in pod_spec["volumes"]
    }
    assert claims == {
        "data": "workout-logger-data",
        "backups": "workout-logger-backups",
    }
    assert cronjob["spec"]["concurrencyPolicy"] == "Forbid"
    args = pod_spec["containers"][0]["args"]
    assert "/data/workout_logger.db" in args
    assert "/backups" in args
    service_selector = resource(resources, "Service")["spec"]["selector"]
    backup_labels = cronjob["spec"]["jobTemplate"]["spec"]["template"]["metadata"]["labels"]
    assert not (service_selector.items() <= backup_labels.items())


def test_restore_configuration_requires_zero_replicas_and_no_migration() -> None:
    for values, expected in (
        (("restore.enabled=true", "migrationJob.enabled=false"), "replicaCount=0"),
        (("restore.enabled=true", "replicaCount=0"), "migrationJob.enabled=false"),
    ):
        command = ["helm", "template", "workout-logger", str(CHART)]
        for value in values:
            command.extend(["--set", value])
        result = subprocess.run(command, check=False, capture_output=True, text=True)

        assert result.returncode != 0
        assert expected in result.stderr


def test_restore_is_a_postsync_job_with_explicit_exclusive_confirmation() -> None:
    resources = render_chart(
        "restore.enabled=true",
        "restore.backupFile=workout_logger-20260821T120000Z.db",
        "replicaCount=0",
        "migrationJob.enabled=false",
    )
    deployment = resource(resources, "Deployment")
    job = resource(resources, "Job")
    pod_spec = job["spec"]["template"]["spec"]

    assert deployment["spec"]["replicas"] == 0
    assert job["metadata"]["annotations"]["argocd.argoproj.io/hook"] == "PostSync"
    assert job["spec"]["backoffLimit"] == 0
    assert "--confirm-exclusive-access" in pod_spec["containers"][0]["args"]
    assert pod_spec["containers"][0]["args"][-1].endswith("20260821T120000Z.db")
    assert pod_spec["volumes"][0]["persistentVolumeClaim"]["claimName"] == ("workout-logger-data")
    assert pod_spec["volumes"][1]["persistentVolumeClaim"]["claimName"] == (
        "workout-logger-backups"
    )
    service_selector = resource(resources, "Service")["spec"]["selector"]
    restore_labels = job["spec"]["template"]["metadata"]["labels"]
    assert not (service_selector.items() <= restore_labels.items())


def test_restore_requires_a_backup_filename() -> None:
    with pytest.raises(subprocess.CalledProcessError):
        render_chart(
            "restore.enabled=true",
            "replicaCount=0",
            "migrationJob.enabled=false",
        )
