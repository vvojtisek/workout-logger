from typing import Annotated

from fastapi import APIRouter, Depends, Response, Security, status
from fastmcp.server.providers.base import Provider
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_session
from app.exceptions import ConflictError, NotFoundError
from app.mcp import mcp
from app.mcp.oauth import SingleOwnerOAuthProvider, unwrap_local_oauth_provider
from app.models.mcp_oauth import McpOAuthClient
from app.schemas.mcp_status import (
    McpOAuthClientInfo,
    McpStatus,
    McpToolInfo,
    PairingWindowResponse,
)
from app.security import AuthContext, require_admin, require_api_key

router = APIRouter(prefix="/mcp-status", tags=["mcp"])
SessionDep = Annotated[AsyncSession, Depends(get_session)]
AuthDep = Annotated[AuthContext, Security(require_api_key)]
AdminDep = Annotated[AuthContext, Security(require_admin)]


def _local_provider() -> SingleOwnerOAuthProvider | None:
    return unwrap_local_oauth_provider(getattr(mcp, "auth", None))


def _require_local_provider() -> SingleOwnerOAuthProvider:
    settings = get_settings()
    if settings.MCP_MODE == "disabled":
        raise ConflictError("MCP server is disabled", code="MCP_DISABLED")
    if not settings.MCP_OAUTH_ENABLED:
        raise ConflictError("MCP OAuth 2.1 is disabled", code="MCP_OAUTH_DISABLED")
    provider = _local_provider()
    if provider is None:
        raise ConflictError(
            "Pairing window requires MCP_OAUTH_PROVIDER=local",
            code="MCP_LOCAL_OAUTH_REQUIRED",
        )
    return provider


@router.get(
    "",
    operation_id="get_mcp_status",
    summary="Get MCP server status",
    description="Reports whether the MCP server is mounted, its active mode, and which tools it "
    "currently exposes, plus linked local OAuth 2.1 clients and pairing-window status for admins.",
    response_model=McpStatus,
)
async def get_mcp_status(session: SessionDep, auth: AuthDep) -> McpStatus:
    settings = get_settings()
    enabled = settings.MCP_MODE != "disabled"
    tools = await Provider.list_tools(mcp) if enabled else []
    provider = _local_provider()

    pairing_expires = None
    clients: list[McpOAuthClientInfo] | None = None
    is_admin = auth.has_scope("admin") or (auth.user is not None and auth.user.role == "admin")
    if is_admin:
        if provider is not None and enabled:
            pairing_expires = provider.pairing_window_expires_at
        rows = (
            await session.scalars(
                select(McpOAuthClient)
                .where(McpOAuthClient.revoked_at.is_(None))
                .order_by(McpOAuthClient.created_at.desc())
            )
        ).all()
        clients = [
            McpOAuthClientInfo(
                client_id=row.client_id,
                client_name=row.client_name,
                scopes=row.allowed_scopes.split(),
                created_at=row.created_at,
                last_used_at=row.last_used_at,
            )
            for row in rows
        ]

    return McpStatus(
        enabled=enabled,
        mode=settings.MCP_MODE,
        oauth_enabled=settings.MCP_OAUTH_ENABLED,
        path="/mcp",
        tool_count=len(tools),
        tools=[McpToolInfo(name=tool.name, description=tool.description or "") for tool in tools],
        pairing_window_expires_at=pairing_expires,
        clients=clients,
    )


@router.post(
    "/pairing-window",
    operation_id="open_mcp_pairing_window",
    summary="Open a 10-minute Dynamic Client Registration pairing window",
    response_model=PairingWindowResponse,
)
async def open_pairing_window(_admin: AdminDep) -> PairingWindowResponse:
    provider = _require_local_provider()
    expires_at = provider.open_pairing_window()
    return PairingWindowResponse(pairing_window_expires_at=expires_at)


@router.delete(
    "/pairing-window",
    operation_id="close_mcp_pairing_window",
    summary="Close the Dynamic Client Registration pairing window immediately",
    response_model=PairingWindowResponse,
)
async def close_pairing_window(_admin: AdminDep) -> PairingWindowResponse:
    provider = _require_local_provider()
    provider.close_pairing_window()
    return PairingWindowResponse(pairing_window_expires_at=None)


@router.delete(
    "/clients/{client_id}",
    operation_id="revoke_mcp_oauth_client",
    summary="Revoke a linked MCP OAuth 2.1 client and all its tokens",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def revoke_mcp_oauth_client(
    client_id: str,
    session: SessionDep,
    _admin: AdminDep,
) -> Response:
    provider = _require_local_provider()
    revoked = await provider.revoke_client(session, client_id)
    if not revoked:
        raise NotFoundError("MCP OAuth client not found", code="MCP_CLIENT_NOT_FOUND")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
