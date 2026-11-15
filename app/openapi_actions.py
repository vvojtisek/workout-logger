"""A small OpenAPI 3.1 document for ChatGPT Custom GPT Actions and other
OpenAPI-driven agents, served at /openapi/actions.json.

The full schema at /openapi.json has well over 100 operations; a GPT's
action editor rejects more than 30 (the documented limit at the time of
writing). This keeps the coaching loop plus the reads an assistant needs,
with short descriptions, X-API-Key as the only security scheme, and only
the component schemas those operations reference.
"""

import copy
import json
from typing import Any

ACTION_OPERATIONS: tuple[str, ...] = (
    "get_coaching_context",
    "log_readiness_and_activity",
    "get_activity_defaults",
    "upsert_daily_nutrition_plan",
    "upsert_adaptive_workout_plan",
    "get_exercise_baseline",
    "get_athlete_profile",
    "get_coaching_principles",
    "list_readiness_logs",
    "list_meal_plans",
    "get_meal_plan",
    "mark_planned_meal_eaten",
    "get_grocery_list",
    "list_supplements",
    "get_supplements_due",
    "get_nutrition_daily_summary",
    "list_workout_logs",
    "get_workout_log",
    "create_workout_log",
    "list_sleep_entries",
    "get_sleep_trends",
    "list_body_metrics",
    "get_body_metric_trends",
    "list_workout_plans",
    "get_workout_plan",
    "get_calendar",
)
MAX_OPERATIONS = 30
MAX_DESCRIPTION = 300
SECURITY_SCHEME = "APIKeyHeader"
_HTTP_METHODS = {"get", "put", "post", "delete", "patch"}


def _short(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= MAX_DESCRIPTION else text[: MAX_DESCRIPTION - 1].rstrip() + "…"


def _refs(node: Any, found: set[str]) -> None:
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            found.add(ref.rsplit("/", 1)[-1])
        for value in node.values():
            _refs(value, found)
    elif isinstance(node, list):
        for value in node:
            _refs(value, found)


def build_actions_schema(full: dict[str, Any], server_url: str | None) -> dict[str, Any]:
    wanted = set(ACTION_OPERATIONS)
    paths: dict[str, Any] = {}
    for path, item in full["paths"].items():
        for method, operation in item.items():
            if method not in _HTTP_METHODS or operation.get("operationId") not in wanted:
                continue
            kept = copy.deepcopy(operation)
            kept["description"] = _short(kept.get("description") or kept.get("summary") or "")
            kept["security"] = [{SECURITY_SCHEME: []}]
            for parameter in kept.get("parameters", []):
                if "description" in parameter:
                    parameter["description"] = _short(parameter["description"])
            kept.pop("tags", None)
            paths.setdefault(path, {})[method] = kept

    schemas = full.get("components", {}).get("schemas", {})
    needed: set[str] = set()
    _refs(paths, needed)
    pending = list(needed)
    while pending:
        name = pending.pop()
        nested: set[str] = set()
        _refs(schemas.get(name, {}), nested)
        for item in nested - needed:
            needed.add(item)
            pending.append(item)

    document: dict[str, Any] = {
        "openapi": "3.1.0",
        "info": {
            "title": "Workout Logger coach actions",
            "version": full["info"]["version"],
            "description": (
                "Call get_coaching_context first: it carries the athlete's hard dietary "
                "exclusions, equipment, training, readiness and meal plan. Then write plans "
                "with the upsert operations."
            ),
        },
        "paths": paths,
        "components": {
            "schemas": {name: schemas[name] for name in sorted(needed) if name in schemas},
            "securitySchemes": {
                SECURITY_SCHEME: {"type": "apiKey", "in": "header", "name": "X-API-Key"}
            },
        },
    }
    if server_url:
        document["servers"] = [{"url": server_url}]
    return document


def operation_count(document: dict[str, Any]) -> int:
    return sum(
        1 for item in document["paths"].values() for method in item if method in _HTTP_METHODS
    )


def schema_size_bytes(document: dict[str, Any]) -> int:
    return len(json.dumps(document, separators=(",", ":")).encode())
