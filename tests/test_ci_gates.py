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
AWS_RELEASE = WORKFLOWS / "release.yml"
AWS_DEPLOY = WORKFLOWS / "deploy-aws.yml"
AWS_COMPOSE = ROOT / "deploy" / "aws" / "compose.yaml"
CD_WORKFLOW = WORKFLOWS / "cd.yml"


def fast_workflow() -> dict:
    return yaml.safe_load(FAST_WORKFLOW.read_text())


def merge_workflow() -> dict:
    return yaml.safe_load(MERGE_WORKFLOW.read_text())


def test_ci_runs_required_parallel_gates_on_pull_requests_and_main() -> None:
    fast = fast_workflow()
    fast_triggers = fast[True]
    assert "pull_request" in fast_triggers
    assert {"backend", "frontend", "deployment"} <= set(fast["jobs"])

    merge = merge_workflow()
    merge_triggers = merge[True]
    assert merge_triggers["push"]["branches"] == ["main"]
    assert {"e2e", "publish"} <= set(merge["jobs"])


def test_end_to_end_suite_gates_pull_requests_before_merge() -> None:
    triggers = merge_workflow()[True]

    # Every pull request runs the full Playwright suite against the production
    # Compose file, so a breaking change is caught before it reaches main. No
    # path filter: a filtered-out run never reports, which would block
    # documentation-only pull requests if this check is made required.
    assert triggers["pull_request"] is None or "paths-ignore" not in triggers["pull_request"]
    assert "if" not in merge_workflow()["jobs"]["e2e"]


def test_pull_requests_review_dependency_changes() -> None:
    review = fast_workflow()["jobs"]["dependency-review"]

    assert "actions/dependency-review-action" in yaml.safe_dump(review)
    assert review["permissions"] == {"contents": "read", "pull-requests": "read"}


def test_release_requires_green_merge_checks_on_main_for_the_tagged_code() -> None:
    validate = yaml.safe_load(AWS_RELEASE.read_text())["jobs"]["validate"]
    validate_text = yaml.safe_dump(validate)

    assert validate["permissions"]["actions"] == "read"
    assert "actions/workflows/ci-merge.yml/runs" in validate_text
    assert "event=push&branch=main" in validate_text
    assert "status=success" in validate_text


def test_untrusted_pull_requests_cannot_publish_or_promote() -> None:
    publish = merge_workflow()["jobs"]["publish"]

    assert set(publish["needs"]) == {"e2e"}
    assert "github.event_name == 'push'" in publish["if"]
    assert "!contains(github.event.head_commit.message, '[skip image publish]')" in publish["if"]


def test_main_builds_publish_an_image_without_promotion_pull_requests() -> None:
    publish_text = yaml.safe_dump(merge_workflow()["jobs"]["publish"])

    assert "docker/build-push-action" in publish_text
    assert "sbom: true" in publish_text
    assert "promote_image.py" not in publish_text
    assert "gh pr create" not in publish_text
    assert "gh pr merge" not in publish_text


def test_deployment_and_security_gates_have_explicit_thresholds() -> None:
    deployment_text = yaml.safe_dump(fast_workflow()["jobs"]["deployment"])
    security_text = SECURITY_WORKFLOW.read_text()

    assert "deploy/aws/compose.yaml" in deployment_text
    assert "config --quiet" in deployment_text
    assert "bash -n scripts/deploy-aws-release.sh" in deployment_text
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


def test_e2e_runs_the_production_compose_file_with_real_image_and_database() -> None:
    text = MERGE_WORKFLOW.read_text()
    e2e_job = merge_workflow()["jobs"]["e2e"]
    step_text = yaml.safe_dump(e2e_job)

    assert "docker/build-push-action" in step_text
    assert "load: true" in step_text
    assert "type=gha" in step_text
    assert "-f deploy/aws/compose.yaml -f e2e/compose.e2e.yaml" in step_text
    assert "--wait" in step_text
    assert "alembic_version" in text
    assert "npm run test:e2e" in step_text
    assert "assert_empty_e2e_database.py" in step_text
    assert "always()" in step_text
    assert "actions/upload-artifact" in step_text
    assert "down --volumes" in step_text
    assert "k3d" not in text
    assert "kubectl" not in text


def test_kubernetes_deployment_artifacts_are_removed() -> None:
    for path in (
        "helm",
        "deploy/argocd",
        "deploy/k3s",
        "values-local.yaml",
        "scripts/promote_image.py",
        "scripts/verify_deployment_image.py",
    ):
        assert not (ROOT / path).exists(), path


def test_aws_release_is_downloadable_and_deploys_through_ssm_only() -> None:
    release_text = AWS_RELEASE.read_text()
    release = yaml.safe_load(release_text)
    assert release[True]["push"]["tags"] == ["v*"]
    assert "git merge-base --is-ancestor" in release_text
    assert "platforms: linux/amd64,linux/arm64" in release_text
    assert "sbom: true" in release_text
    assert "provenance: true" in release_text
    assert "for architecture in amd64 arm64" in release_text
    assert "linux-${architecture}-image.tar.gz" in release_text
    assert 'gh release create "$RELEASE_TAG"' in release_text
    assert "sha256sum ./*" in release_text
    deploy_job = release["jobs"]["deploy"]
    assert deploy_job["uses"] == "./.github/workflows/deploy-aws.yml"
    assert deploy_job["needs"] == "publish"
    assert deploy_job["if"] == "inputs.tag != ''"
    dispatch = release["jobs"]["dispatch-deploy"]
    assert dispatch["if"] == "inputs.tag == ''"
    assert "gh workflow run deploy-aws.yml" in release_text

    deploy_text = AWS_DEPLOY.read_text()
    deploy = yaml.safe_load(deploy_text)
    assert "workflow_dispatch" in deploy[True]
    assert "id-token: write" in deploy_text
    assert "i-08abc66a2687aed45" in deploy_text
    assert "ssm send-command" in deploy_text
    assert 'script_path = "/tmp/deploy-workout-logger.sh"' in deploy_text
    assert "sha256sum --check --strict --status" in deploy_text
    assert "https://fitness.vvojtisek.eu/health/ready" in deploy_text
    assert '"ec2:ModifySecurityGroupRules"' not in deploy_text

    release_script = (ROOT / "scripts" / "deploy-aws-release.sh").read_text()
    assert "x86_64|amd64)" in release_script
    assert "aarch64|arm64)" in release_script
    assert "linux-${image_arch}-image.tar.gz" in release_script

    compose = yaml.safe_load(AWS_COMPOSE.read_text())
    compose_text = AWS_COMPOSE.read_text()
    assert "chem-app_public-net" in compose_text
    service = compose["services"]["workout-logger"]
    assert service["expose"] == ["8000"]
    assert "ports" not in service


def test_merges_to_main_release_only_after_green_merge_checks() -> None:
    cd = yaml.safe_load(CD_WORKFLOW.read_text())
    trigger = cd[True]["workflow_run"]
    plan = cd["jobs"]["plan"]

    assert trigger == {"workflows": ["Merge checks"], "types": ["completed"], "branches": ["main"]}
    assert "github.event.workflow_run.conclusion == 'success'" in plan["if"]
    assert "github.event.workflow_run.event == 'push'" in plan["if"]
    assert "head_repository.full_name == github.repository" in plan["if"]
    # Loop guards: bot commits and release commits never start a release.
    assert "author.name != 'github-actions[bot]'" in plan["if"]
    assert (
        "!startsWith(github.event.workflow_run.head_commit.message, 'chore(release):')"
        in (plan["if"])
    )
    assert "vars.AUTO_RELEASE != 'false'" in plan["if"]
    assert cd["permissions"] == {}
    assert cd["concurrency"] == {"group": "continuous-delivery", "cancel-in-progress": False}

    plan_text = yaml.safe_dump(plan)
    assert "fetch-depth: 0" in plan_text
    assert "github.event.workflow_run.head_sha" in plan_text
    assert "scripts/release_version.py next" in plan_text

    release = cd["jobs"]["release"]
    assert release["needs"] == "plan"
    assert release["if"] == "needs.plan.outputs.release == 'true'"
    assert release["uses"] == "./.github/workflows/release.yml"
    assert release["with"] == {
        "tag": "${{ needs.plan.outputs.tag }}",
        "sha": "${{ needs.plan.outputs.sha }}",
    }


def test_release_builds_the_tested_commit_tags_it_and_moves_latest_last() -> None:
    release_text = AWS_RELEASE.read_text()
    release = yaml.safe_load(release_text)

    assert set(release[True]["workflow_call"]["inputs"]) == {"tag", "sha"}
    assert release["env"]["RELEASE_SHA"] == "${{ inputs.sha || github.sha }}"
    assert release["concurrency"]["cancel-in-progress"] is False

    steps = [step["name"] for step in release["jobs"]["publish"]["steps"]]
    build = steps.index("Build and publish multi-architecture image for EC2")
    tag = steps.index("Create the tag and the versioned GitHub release")
    latest = steps.index("Point the latest image tag at the highest release")
    assert build < tag < latest
    assert '--target "$RELEASE_SHA"' in release_text
    assert "--verify-tag" in release_text
    assert "release_version.py notes" in release_text
    assert 'imagetools create --tag "$IMAGE:latest"' in release_text
    assert "APP_VERSION=${{ env.RELEASE_TAG }}" in release_text
    for job in ("validate", "publish"):
        assert "ref: ${{ env.RELEASE_SHA }}" in yaml.safe_dump(release["jobs"][job], width=1000)


def test_deploy_is_serialised_and_waits_for_the_new_version() -> None:
    deploy_text = AWS_DEPLOY.read_text()
    deploy = yaml.safe_load(deploy_text)

    assert "release_tag" in deploy[True]["workflow_call"]["inputs"]
    assert deploy["concurrency"] == {"group": "aws-production-deploy", "cancel-in-progress": False}
    assert deploy["jobs"]["deploy"]["if"] == "vars.AWS_DEPLOY_ROLE_ARN != ''"
    assert 'TIMEOUT_SECONDS: "300"' in deploy_text
    assert '"$version" == "$RELEASE_TAG"' in deploy_text
    assert "--max-time 10" in deploy_text
    assert "exit 1" in deploy_text
