"""Guards the assumption that makes `SameSite=Lax` sufficient CSRF protection
without a separate CSRF token: no GET/HEAD route may mutate state. A
cross-site page can trivially cause a victim's browser to issue a same-site
GET (an <img> tag, a prefetch), so GET must stay read-only forever."""

import ast
from pathlib import Path

API_V1_DIR = Path(__file__).resolve().parent.parent / "app" / "api" / "v1"

_SAFE_METHODS = {"get", "head"}

_MUTATING_PREFIXES = (
    "create_",
    "update_",
    "delete_",
    "revoke_",
    "accept_",
    "issue_",
    "reset_",
    "disable_",
    "enable_",
    "register_",
    "add_",
    "remove_",
    "log_",
    "record_",
    "set_",
    "replace_",
)


def _is_router_method_call(deco: ast.expr, methods: set[str]) -> bool:
    func = deco.func if isinstance(deco, ast.Call) else deco
    return (
        isinstance(func, ast.Attribute)
        and func.attr in methods
        and isinstance(func.value, ast.Name)
        and func.value.id == "router"
    )


def _route_functions(tree: ast.Module, methods: set[str]) -> list[ast.AsyncFunctionDef]:
    functions = []
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef | ast.FunctionDef):
            if any(_is_router_method_call(deco, methods) for deco in node.decorator_list):
                functions.append(node)
    return functions


def _call_names(node: ast.AST) -> list[str]:
    names = []
    for sub in ast.walk(node):
        if isinstance(sub, ast.Call):
            target = sub.func
            if isinstance(target, ast.Attribute):
                names.append(target.attr)
            elif isinstance(target, ast.Name):
                names.append(target.id)
    return names


def test_no_get_or_head_route_calls_a_mutating_function():
    offenders = []
    for path in sorted(API_V1_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(), filename=str(path))
        for func in _route_functions(tree, _SAFE_METHODS):
            for name in _call_names(func):
                if name == "commit" or name.startswith(_MUTATING_PREFIXES):
                    offenders.append(f"{path.name}:{func.name} calls `{name}`")
    assert not offenders, "GET/HEAD routes must never mutate state:\n" + "\n".join(offenders)


def test_the_audit_actually_detects_a_mutating_get_route():
    """Proves the AST walk above isn't vacuously passing -- a synthetic GET
    handler that calls a mutating-looking function must be flagged."""
    source = (
        "from fastapi import APIRouter\n"
        "router = APIRouter()\n\n"
        "@router.get('/danger')\n"
        "async def danger():\n"
        "    return await create_something()\n"
    )
    tree = ast.parse(source)
    offenders = [
        name
        for func in _route_functions(tree, _SAFE_METHODS)
        for name in _call_names(func)
        if name == "commit" or name.startswith(_MUTATING_PREFIXES)
    ]
    assert offenders == ["create_something"]
