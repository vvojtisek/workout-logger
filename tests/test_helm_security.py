from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]
CHART = ROOT / "helm" / "workout-logger"
PRODUCTION_VALUES = CHART / "values-prod.yaml"
SCHEMA = CHART / "values.schema.json"


def render_chart(*extra_args: str) -> list[dict]:
    result = subprocess.run(
        ["helm", "template", "workout-logger", str(CHART), *extra_args],
        check=True,
        capture_output=True,
        text=True,
    )
    return [document for document in yaml.safe_load_all(result.stdout) if document]


def pod_specs(documents: list[dict]) -> list[dict]:
    specs = []
    for document in documents:
        kind = document["kind"]
        if kind in {"Deployment", "Job"}:
            specs.append(document["spec"]["template"]["spec"])
        elif kind == "CronJob":
            specs.append(document["spec"]["jobTemplate"]["spec"]["template"]["spec"])
    return specs


@pytest.mark.parametrize("values_args", [(), ("--values", str(PRODUCTION_VALUES))])
def test_default_and_production_values_lint_and_disable_api_tokens(
    values_args: tuple[str, ...],
) -> None:
    subprocess.run(
        ["helm", "lint", str(CHART), *values_args],
        check=True,
        capture_output=True,
        text=True,
    )
    documents = render_chart(*values_args)

    service_account = next(
        document for document in documents if document["kind"] == "ServiceAccount"
    )
    assert service_account["automountServiceAccountToken"] is False
    assert all(spec["automountServiceAccountToken"] is False for spec in pod_specs(documents))


def test_custom_existing_secret_updates_every_api_key_reference() -> None:
    documents = render_chart("--set-string", "existingSecret=external-api-credentials")
    secret_names = {
        env["valueFrom"]["secretKeyRef"]["name"]
        for spec in pod_specs(documents)
        for container in spec["containers"]
        for env in container.get("env", [])
        if "secretKeyRef" in env.get("valueFrom", {})
    }

    assert secret_names == {"external-api-credentials"}


def test_empty_required_secret_name_fails_before_rendering() -> None:
    result = subprocess.run(
        ["helm", "template", "workout-logger", str(CHART), "--set-string", "existingSecret="],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "existingSecret" in result.stderr


def test_production_ingress_requests_certificate_from_production_issuer() -> None:
    documents = render_chart("--values", str(PRODUCTION_VALUES))
    ingress = next(document for document in documents if document["kind"] == "Ingress")

    assert ingress["metadata"]["annotations"]["cert-manager.io/cluster-issuer"] == (
        "letsencrypt-prod"
    )
    assert ingress["spec"]["tls"] == [
        {
            "hosts": ["fitness.vvojtisek.eu"],
            "secretName": "workout-logger-tls",
        }
    ]


def test_values_schema_and_sqlite_security_context_cover_writable_data_volume() -> None:
    schema = json.loads(SCHEMA.read_text())
    assert schema["properties"]["existingSecret"]["minLength"] == 1

    documents = render_chart()
    deployment = next(document for document in documents if document["kind"] == "Deployment")
    pod_spec = deployment["spec"]["template"]["spec"]
    container = pod_spec["containers"][0]

    assert pod_spec["securityContext"]["runAsNonRoot"] is True
    assert pod_spec["securityContext"]["runAsUser"] == 10001
    assert pod_spec["securityContext"]["runAsGroup"] == 10001
    assert pod_spec["securityContext"]["fsGroup"] == 10001
    assert container["securityContext"]["allowPrivilegeEscalation"] is False
    assert {mount["mountPath"] for mount in container["volumeMounts"]} == {"/data"}
    assert pod_spec["volumes"][0]["persistentVolumeClaim"]["claimName"] == "workout-logger-data"
