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


def test_backup_pvc_bind_job_makes_it_the_wait_for_first_consumer_pvcs_first_consumer() -> None:
    resources = render_chart()
    jobs = [item for item in resources if item["kind"] == "Job"]
    bind_job = next(job for job in jobs if "backup-pvc-bind" in job["metadata"]["name"])

    # A plain (non-hook) resource, so it is applied in the same sync wave as
    # the backups PVC itself - not deferred to a PreSync/PostSync phase that
    # would never run while that PVC is still blocking the main sync on a
    # WaitForFirstConsumer storage class.
    assert "argocd.argoproj.io/hook" not in bind_job["metadata"].get("annotations", {})

    pod_spec = bind_job["spec"]["template"]["spec"]
    claims = {
        volume["name"]: volume["persistentVolumeClaim"]["claimName"]
        for volume in pod_spec["volumes"]
    }
    assert claims == {"backups": "workout-logger-backups"}

    service_selector = resource(resources, "Service")["spec"]["selector"]
    bind_labels = bind_job["spec"]["template"]["metadata"]["labels"]
    assert not (service_selector.items() <= bind_labels.items())


def test_backup_pvc_bind_job_absent_when_backup_persistence_disabled_or_external() -> None:
    for values in (
        ("backupPersistence.enabled=false",),
        ("backupPersistence.enabled=true", "backupPersistence.existingClaim=external-backups"),
    ):
        resources = render_chart(*values)
        jobs = [item for item in resources if item["kind"] == "Job"]
        assert not any("backup-pvc-bind" in job["metadata"]["name"] for job in jobs)


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
    # The backups PVC bind job (see backup-pvc-bind-job.yaml) also renders
    # alongside this one whenever backupPersistence is enabled, so the
    # restore job must be picked out specifically rather than assuming it is
    # the only Job in the manifest.
    job = next(
        item
        for item in resources
        if item["kind"] == "Job" and "-restore-" in item["metadata"]["name"]
    )
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
