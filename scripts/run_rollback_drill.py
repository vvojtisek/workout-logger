"""Exercise failed Git desired state and LKG recovery through real Argo CD."""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from contextlib import suppress
from pathlib import Path
from typing import Any

import yaml
from promote_image import promote

ROOT = Path(__file__).resolve().parents[1]
TEST_RUN_ID = "issue2-gitops-rollback-drill"
NAMESPACE = "rollback-drill"
APPLICATION = "workout-logger-rollback-drill"
API_KEY = "rollback-drill-key-00000000000000"
BROKEN_DIGEST = "sha256:" + "f" * 64


class DrillError(RuntimeError):
    """Raised when the rollback drill does not reach an expected state."""


class Evidence:
    def __init__(self, directory: Path) -> None:
        self.directory = directory
        directory.mkdir(parents=True, exist_ok=True)
        self.log_path = directory / "commands.log"

    def run(self, command: list[str], *, cwd: Path | None = None, check: bool = True) -> str:
        result = subprocess.run(command, cwd=cwd, check=False, capture_output=True, text=True)
        with self.log_path.open("a", encoding="utf-8") as stream:
            stream.write(f"$ {' '.join(command)}\n{result.stdout}{result.stderr}\n")
        if check and result.returncode != 0:
            raise DrillError(f"command failed ({result.returncode}): {' '.join(command)}")
        return result.stdout


def wait_for(evidence: Evidence, description: str, predicate: Any, timeout: int = 180) -> Any:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(2)
    raise DrillError(f"timed out waiting for {description}")


def application_status(evidence: Evidence) -> dict[str, Any]:
    output = evidence.run(
        ["kubectl", "get", "application", APPLICATION, "-n", "argocd", "-o", "json"],
        check=False,
    )
    return json.loads(output) if output else {}


def refresh(evidence: Evidence) -> None:
    evidence.run(
        [
            "kubectl",
            "annotate",
            "application",
            APPLICATION,
            "-n",
            "argocd",
            "argocd.argoproj.io/refresh=hard",
            "--overwrite",
        ]
    )


def api_request(method: str, path: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        f"http://127.0.0.1:18009{path}",
        method=method,
        data=data,
        headers={"X-API-Key": API_KEY, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            contents = response.read()
            return response.status, json.loads(contents) if contents else None
    except urllib.error.HTTPError as exc:
        return exc.code, None


def write_prerequisites(evidence: Evidence, directory: Path) -> None:
    prerequisites = [
        {
            "apiVersion": "v1",
            "kind": "Namespace",
            "metadata": {"name": NAMESPACE, "labels": {"test-run-id": TEST_RUN_ID}},
        },
        {
            "apiVersion": "v1",
            "kind": "ServiceAccount",
            "metadata": {"name": "workout-logger", "namespace": NAMESPACE},
        },
        {
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {"name": "workout-logger-secret", "namespace": NAMESPACE},
            "stringData": {"API_KEY": API_KEY},
        },
        {
            "apiVersion": "v1",
            "kind": "PersistentVolumeClaim",
            "metadata": {"name": "workout-logger-data", "namespace": NAMESPACE},
            "spec": {
                "accessModes": ["ReadWriteOnce"],
                "resources": {"requests": {"storage": "1Gi"}},
            },
        },
    ]
    path = directory / "prerequisites.yaml"
    path.write_text(yaml.safe_dump_all(prerequisites, sort_keys=False), encoding="utf-8")
    evidence.run(["kubectl", "apply", "-f", str(path)])


def commit(evidence: Evidence, worktree: Path, message: str) -> str:
    evidence.run(["git", "add", "--", "helm/workout-logger/values-staging.yaml"], cwd=worktree)
    evidence.run(["git", "commit", "-m", message], cwd=worktree)
    revision = evidence.run(["git", "rev-parse", "HEAD"], cwd=worktree).strip()
    evidence.run(["git", "push", "origin", "main"], cwd=worktree)
    return revision


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    evidence = Evidence(args.artifacts.resolve())
    port_forward: subprocess.Popen[str] | None = None
    git_daemon: subprocess.Popen[str] | None = None
    record_id: str | None = None

    with tempfile.TemporaryDirectory(prefix="workout-rollback-") as temporary:
        temp = Path(temporary)
        worktree = temp / "worktree"
        bare = temp / "workout-logger.git"
        try:
            evidence.run(["git", "clone", "--no-local", str(ROOT), str(worktree)])
            evidence.run(["git", "checkout", "-B", "main"], cwd=worktree)
            evidence.run(["git", "config", "user.name", "github-actions[bot]"], cwd=worktree)
            evidence.run(
                [
                    "git",
                    "config",
                    "user.email",
                    "41898282+github-actions[bot]@users.noreply.github.com",
                ],
                cwd=worktree,
            )
            evidence.run(["git", "clone", "--bare", str(worktree), str(bare)])
            evidence.run(["git", "remote", "set-url", "origin", str(bare)], cwd=worktree)
            git_daemon = subprocess.Popen(
                [
                    "git",
                    "daemon",
                    "--reuseaddr",
                    "--export-all",
                    "--enable=receive-pack",
                    "--base-path",
                    str(temp),
                    str(bare),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            time.sleep(1)

            write_prerequisites(evidence, temp)
            application = yaml.safe_load(
                (worktree / "deploy/argocd/application-staging.yaml").read_text()
            )
            application["metadata"]["name"] = APPLICATION
            application["metadata"].pop("finalizers", None)
            application["spec"]["source"]["repoURL"] = "git://host.k3d.internal/workout-logger.git"
            application["spec"]["destination"]["namespace"] = NAMESPACE
            application["spec"]["syncPolicy"]["retry"] = {"limit": 0}
            app_path = temp / "application.yaml"
            app_path.write_text(yaml.safe_dump(application, sort_keys=False), encoding="utf-8")
            evidence.run(["kubectl", "apply", "-f", str(app_path)])
            refresh(evidence)

            def healthy() -> bool:
                status = application_status(evidence).get("status", {})
                return (
                    status.get("sync", {}).get("status") == "Synced"
                    and status.get("health", {}).get("status") == "Healthy"
                )

            wait_for(evidence, "initial Argo health", healthy, 300)
            port_forward = subprocess.Popen(
                [
                    "kubectl",
                    "port-forward",
                    "-n",
                    NAMESPACE,
                    "service/workout-logger",
                    "18009:8000",
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            wait_for(evidence, "ready API", lambda: api_request("GET", "/health/ready")[0] == 200)
            status, record = api_request(
                "POST",
                "/api/v1/plans",
                {
                    "name": f"{TEST_RUN_ID} plan",
                    "description": "must survive failed desired state",
                    "exercises": [],
                },
            )
            if status != 201:
                raise DrillError(f"record creation returned {status}")
            record_id = record["id"]

            staging_values = worktree / "helm/workout-logger/values-staging.yaml"
            stable = json.loads((worktree / "environments/staging/release-state.json").read_text())[
                "lastKnownGood"
            ]
            promote(staging_values, BROKEN_DIGEST, "f" * 40)
            broken_revision = commit(evidence, worktree, "test: deploy deliberately broken digest")
            refresh(evidence)

            def failed() -> bool:
                status = application_status(evidence).get("status", {})
                operation = status.get("operationState", {})
                return status.get("sync", {}).get("revision") == broken_revision and operation.get(
                    "phase"
                ) in {"Failed", "Error"}

            wait_for(evidence, "broken desired state failure", failed, 180)
            if api_request("GET", f"/api/v1/plans/{record_id}")[0] != 200:
                raise DrillError("stable record was disturbed by failed desired state")

            evidence.run(
                [
                    "python",
                    "scripts/rollback_release.py",
                    "--values",
                    "helm/workout-logger/values-staging.yaml",
                    "--state",
                    "environments/staging/release-state.json",
                ],
                cwd=worktree,
            )
            rollback_revision = commit(
                evidence, worktree, "revert(staging): restore last-known-good release"
            )
            refresh(evidence)

            def recovered() -> bool:
                status = application_status(evidence).get("status", {})
                return (
                    status.get("sync", {}).get("revision") == rollback_revision
                    and status.get("sync", {}).get("status") == "Synced"
                    and status.get("health", {}).get("status") == "Healthy"
                )

            wait_for(evidence, "Argo LKG recovery", recovered, 300)
            status, recovered_record = api_request("GET", f"/api/v1/plans/{record_id}")
            if status != 200 or recovered_record["name"] != f"{TEST_RUN_ID} plan":
                raise DrillError("record was not preserved after rollback")
            if api_request("DELETE", f"/api/v1/plans/{record_id}")[0] != 204:
                raise DrillError("tagged record cleanup failed")
            if api_request("GET", f"/api/v1/plans/{record_id}")[0] != 404:
                raise DrillError("tagged record cleanup was not verified")
            record_id = None

            summary = {
                "testRunId": TEST_RUN_ID,
                "brokenRevision": broken_revision,
                "rollbackRevision": rollback_revision,
                "lastKnownGoodDigest": stable["imageDigest"],
                "lastKnownGoodCommit": stable["sourceCommit"],
                "result": "passed",
            }
            (args.artifacts / "summary.json").write_text(
                json.dumps(summary, indent=2) + "\n", encoding="utf-8"
            )
        finally:
            if record_id and port_forward:
                with suppress(Exception):
                    api_request("DELETE", f"/api/v1/plans/{record_id}")
            if port_forward:
                port_forward.terminate()
                with suppress(subprocess.TimeoutExpired):
                    port_forward.wait(timeout=5)
            with suppress(Exception):
                evidence.run(
                    ["kubectl", "get", "application", APPLICATION, "-n", "argocd", "-o", "yaml"],
                    check=False,
                )
                evidence.run(["kubectl", "get", "all", "-n", NAMESPACE, "-o", "wide"], check=False)
                evidence.run(["kubectl", "get", "events", "-n", NAMESPACE], check=False)
                evidence.run(
                    [
                        "kubectl",
                        "delete",
                        "application",
                        APPLICATION,
                        "-n",
                        "argocd",
                        "--wait=false",
                    ],
                    check=False,
                )
                evidence.run(
                    ["kubectl", "delete", "namespace", NAMESPACE, "--wait=false"], check=False
                )
            if git_daemon:
                git_daemon.terminate()
                with suppress(subprocess.TimeoutExpired):
                    git_daemon.wait(timeout=5)


if __name__ == "__main__":
    main()
