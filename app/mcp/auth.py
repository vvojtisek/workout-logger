"""Authentication for the MCP transport.

The MCP endpoint is a mounted ASGI app rather than a FastAPI route, so it
cannot use the `Security(require_api_key)` dependency the REST routers share.
Instead a thin ASGI middleware authenticates each request once at the mount
boundary and stashes the resolved `AuthContext` in a context variable, which
the tools then read to enforce their own scope requirement.
"""

import json
from collections.abc import Awaitable, Callable
from contextvars import ContextVar

from fastmcp.exceptions import ToolError
from starlette.exceptions import HTTPException
from starlette.types import Receive, Scope, Send

from app.database import get_session_maker
from app.security import AuthContext, authenticate_api_key

_auth_context: ContextVar[AuthContext | None] = ContextVar("mcp_auth_context", default=None)


class McpScopeError(ToolError):
    """Raised by a tool whose caller lacks the scope that tool requires.
    Subclasses ToolError so the reason reaches the agent instead of being
    masked as a generic internal error."""


def current_auth() -> AuthContext:
    auth = _auth_context.get()
    if auth is None:
        raise McpScopeError("MCP request is not authenticated")
    return auth


def require_scope(scope: str) -> AuthContext:
    """Guard placed at the top of every tool. `read` covers the query tools,
    `log` the ones that write; an `admin` token satisfies both."""
    auth = current_auth()
    if not auth.has_scope(scope):
        raise McpScopeError(f"Token is missing the required '{scope}' scope")
    return auth


async def _send_401(send: Send, detail: str) -> None:
    body = json.dumps({"detail": detail, "code": "UNAUTHORIZED"}).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": 401,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class McpAuthMiddleware:
    """Rejects unauthenticated MCP traffic before it reaches the transport."""

    def __init__(self, app: Callable[[Scope, Receive, Send], Awaitable[None]]) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope["headers"]
        }
        api_key = headers.get("x-api-key")

        async with get_session_maker()() as session:
            try:
                auth = await authenticate_api_key(api_key, session)
            except HTTPException as exc:
                await _send_401(send, str(exc.detail))
                return

        token = _auth_context.set(auth)
        try:
            await self.app(scope, receive, send)
        finally:
            _auth_context.reset(token)
