"""Least-privilege invariants of the GitHub deploy role (deploy/aws/github-deploy-role.yaml)."""

from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "deploy" / "aws" / "github-deploy-role.yaml"
DEPLOY_WORKFLOW = ROOT / ".github" / "workflows" / "deploy-aws.yml"


def template() -> dict:
    return yaml.safe_load(TEMPLATE.read_text())


def role() -> dict:
    return template()["Resources"]["DeployRole"]["Properties"]


def statements() -> list[dict]:
    return [
        statement
        for policy in role()["Policies"]
        for statement in policy["PolicyDocument"]["Statement"]
    ]


def test_only_the_production_environment_of_this_repository_can_assume_it() -> None:
    (trust,) = role()["AssumeRolePolicyDocument"]["Statement"]
    condition = trust["Condition"]["StringEquals"]

    assert trust["Action"] == "sts:AssumeRoleWithWebIdentity"
    assert condition["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
    assert condition["token.actions.githubusercontent.com:sub"] == {
        "Fn::Sub": "repo:${Repository}:environment:production"
    }
    assert template()["Parameters"]["Repository"]["Default"] == "vvojtisek/workout-logger"


def test_it_can_only_send_the_shell_document_to_the_app_host_and_read_results() -> None:
    actions = {statement["Action"] for statement in statements()}
    assert actions == {"ssm:SendCommand", "ssm:GetCommandInvocation"}
    assert all(statement["Effect"] == "Allow" for statement in statements())

    (send,) = [s for s in statements() if s["Action"] == "ssm:SendCommand"]
    resources = [resource["Fn::Sub"] for resource in send["Resource"]]
    assert resources == [
        "arn:${AWS::Partition}:ec2:${AWS::Region}:${AWS::AccountId}:instance/${InstanceId}",
        "arn:${AWS::Partition}:ssm:${AWS::Region}::document/AWS-RunShellScript",
    ]


def test_the_template_targets_the_instance_the_workflow_deploys_to() -> None:
    workflow = yaml.safe_load(DEPLOY_WORKFLOW.read_text())
    workflow_instance = workflow["jobs"]["deploy"]["env"]["AWS_INSTANCE_ID"]

    assert template()["Parameters"]["InstanceId"]["Default"] == workflow_instance
