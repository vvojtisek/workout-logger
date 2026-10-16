"""Writes one action-log row for every REST write (app/services/audit_log.py).

A plain ASGI middleware rather than `@app.middleware("http")`: it has to see
the request body without consuming it and the response status and body
without buffering the response. Both copies are capped, and only used to
build the row after the response has been sent.
"""

import json
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.services import audit_log

_READ_METHODS = {"GET", "HEAD", "OPTIONS"}
_API_PREFIX = "/api/v1/"
_MAX_CAPTURE_BYTES = 64 * 1024


def _json(raw: bytes) -> Any:
    if not raw or len(raw) >= _MAX_CAPTURE_BYTES:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def _actor(auth: Any) -> tuple[str, str]:
    if auth is None:
        return "anonymous", "-"
    if auth.user is not None:
        return "user", auth.user.email
    if auth.token is not None:
        return "api_token", auth.token.name
    return "api_key", "API_KEY"


class AuditMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] in _READ_METHODS:
            await self.app(scope, receive, send)
            return

        request_body = bytearray()
        response_body = bytearray()
        status: dict[str, int] = {}

        async def capture_receive() -> Message:
            message = await receive()
            if message["type"] == "http.request" and len(request_body) < _MAX_CAPTURE_BYTES:
                request_body.extend(message.get("body", b""))
            return message

        async def capture_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
            elif (
                message["type"] == "http.response.body" and len(response_body) < _MAX_CAPTURE_BYTES
            ):
                response_body.extend(message.get("body", b""))
            await send(message)

        try:
            await self.app(scope, capture_receive, capture_send)
        finally:
            await self._record(scope, bytes(request_body), bytes(response_body), status.get("code"))

    async def _record(
        self, scope: Scope, request_body: bytes, response_body: bytes, status_code: int | None
    ) -> None:
        path = scope.get("path", "")
        if scope.get("route") is None or not path.startswith(_API_PREFIX):
            return
        state = scope.get("state") or {}
        actor_kind, actor = _actor(state.get("auth_context"))

        # The matched route's own path lacks its router's prefix, so the
        # template is rebuilt from the real path: each path parameter's value
        # is put back as its {name}, keeping ids out of the action name.
        path_params = scope.get("path_params") or {}
        by_value = {str(value): name for name, value in path_params.items()}
        template = "/".join(
            f"{{{by_value[segment]}}}" if segment in by_value else segment
            for segment in path.split("/")
        )
        target_type = template.removeprefix(_API_PREFIX).split("/", 1)[0] or None
        target_id = str(list(path_params.values())[-1]) if path_params else None
        response = _json(response_body)
        if target_id is None and isinstance(response, dict) and response.get("id"):
            target_id = str(response["id"])

        succeeded = status_code is not None and status_code < 400
        error = None
        if not succeeded:
            detail = response.get("detail") if isinstance(response, dict) else None
            error = detail if isinstance(detail, str) else f"HTTP {status_code}"

        await audit_log.record(
            actor_kind=actor_kind,
            actor=actor,
            action=f"{scope['method']} {template}",
            outcome="success" if succeeded else "error",
            params=_json(request_body),
            target_type=target_type,
            target_id=target_id,
            status_code=status_code,
            error=error,
            request_id=state.get("request_id"),
        )
