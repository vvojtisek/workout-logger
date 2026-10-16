"""Writes one action-log row for every MCP tool call (app/services/audit_log.py).

What the row can say about the caller is limited to what the protocol
carries: the OAuth subject (who logged in), the OAuth client id and the
name the client gave when it registered (for example "Claude" or
"ChatGPT"), and the name and version the client sends in its MCP
`initialize` request. None of these is verified, and no MCP or OAuth field
names the model behind a client, so the model is never recorded.
"""

import logging
from typing import Any

import mcp.types as mt
from fastmcp.server.dependencies import get_access_token, get_http_headers
from fastmcp.server.middleware import CallNext, Middleware, MiddlewareContext
from fastmcp.tools import ToolResult

from app.services import audit_log

logger = logging.getLogger("workout_logger.audit")

# The record a tool writes or reads, for the log's target column.
_TOOL_TARGETS = {
    "create_plan": "plan",
    "get_plan": "plan",
    "schedule_workout": "scheduled_workout",
    "log_set": "workout_session",
    "log_meal": "meal_entry",
    "log_biometrics": "body_metric",
    "list_programs": "program",
    "get_daily_summary": "nutrition_day",
    "get_coaching_principles": "coaching_principles",
    "get_progression_rules": "progression_rules",
}


async def _oauth_client(context: MiddlewareContext[Any]) -> tuple[str | None, str | None]:
    """The client id and registered name. Behind the Auth0 proxy the verified
    token's own client id is the proxy's single Auth0 application, so the MCP
    client's id is read from the proxy-issued bearer token instead."""
    access = get_access_token()
    client_id = access.client_id if access is not None else None
    fastmcp = context.fastmcp_context.fastmcp if context.fastmcp_context else None
    auth = getattr(fastmcp, "auth", None)
    proxy = getattr(auth, "_delegate", auth)
    issuer = getattr(proxy, "jwt_issuer", None)
    if proxy is None or issuer is None:
        return client_id, None
    bearer = get_http_headers(include={"authorization"}).get("authorization", "")
    try:
        payload = issuer.verify_token(bearer.removeprefix("Bearer ").strip())
    except Exception:  # noqa: BLE001 - an unreadable token only loses the client name
        return client_id, None
    client_id = payload.get("client_id") or client_id
    client = await proxy.get_client(client_id) if client_id else None
    return client_id, getattr(client, "client_name", None)


_CLIENT_INFO_META = "io.modelcontextprotocol/clientInfo"


def _client_info(context: MiddlewareContext[Any]) -> tuple[str | None, str | None]:
    """The client's self-reported name and version: from `initialize` on
    handshake protocol versions, or from each request's `_meta` on 2026-07-28+."""
    fastmcp_context = context.fastmcp_context
    if fastmcp_context is None:
        return None, None
    params = getattr(fastmcp_context.session, "client_params", None)
    info: Any = getattr(params, "client_info", None)
    if info is None:
        meta = getattr(fastmcp_context.request_context, "meta", None) or {}
        info = meta.get(_CLIENT_INFO_META) if isinstance(meta, dict) else None
    if isinstance(info, dict):
        return info.get("name"), info.get("version")
    return getattr(info, "name", None), getattr(info, "version", None)


def _target_id(arguments: dict[str, Any], result: ToolResult | None) -> str | None:
    for key, value in arguments.items():
        if key.endswith("_id") and key != "client_operation_id" and value:
            return str(value)
    content = result.structured_content if result is not None else None
    if isinstance(content, dict):
        if content.get("id"):
            return str(content["id"])
        session = content.get("session")
        if isinstance(session, dict) and session.get("id"):
            return str(session["id"])
    return None


class AuditMiddleware(Middleware):
    async def on_call_tool(
        self,
        context: MiddlewareContext[mt.CallToolRequestParams],
        call_next: CallNext[mt.CallToolRequestParams, ToolResult],
    ) -> ToolResult:
        name = context.message.name
        arguments = dict(context.message.arguments or {})
        result: ToolResult | None = None
        error: str | None = None
        try:
            result = await call_next(context)
            return result
        except Exception as exc:
            error = str(exc) or type(exc).__name__
            raise
        finally:
            try:
                await _record(context, name, arguments, result, error)
            except Exception:  # logging must never fail the tool call
                logger.exception("Could not write action log entry for MCP tool %s", name)


async def _record(
    context: MiddlewareContext[Any],
    name: str,
    arguments: dict[str, Any],
    result: ToolResult | None,
    error: str | None,
) -> None:
    access = get_access_token()
    subject = None
    if access is not None:
        subject = access.subject or (access.claims or {}).get("sub")
    client_id, client_name = await _oauth_client(context)
    info_name, info_version = _client_info(context)
    await audit_log.record(
        actor_kind="mcp",
        actor=client_name or info_name or client_id or "MCP client",
        actor_subject=subject,
        oauth_client_id=client_id,
        oauth_client_name=client_name,
        mcp_client_name=info_name,
        mcp_client_version=info_version,
        action=f"mcp:{name}",
        outcome="error" if error is not None else "success",
        params=arguments,
        target_type=_TOOL_TARGETS.get(name),
        target_id=_target_id(arguments, result),
        error=error,
    )
