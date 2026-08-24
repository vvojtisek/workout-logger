from fastapi import APIRouter
from fastmcp.server.providers.base import Provider

from app.mcp import mcp
from app.schemas.mcp_status import McpStatus, McpToolInfo

router = APIRouter(prefix="/mcp-status", tags=["mcp"])


@router.get(
    "",
    operation_id="get_mcp_status",
    summary="Get MCP server status",
    description="Reports whether the MCP server is mounted and which tools it currently "
    "exposes, for a Settings page runtime check rather than for tool invocation.",
    response_model=McpStatus,
)
async def get_mcp_status() -> McpStatus:
    # `mcp.list_tools()` applies FastMCP's per-tool OAuth scope filtering,
    # which requires a caller access token. This is an internal REST
    # introspection endpoint (already behind the REST X-API-Key dependency)
    # rather than an MCP tool call, so it reads the full registered tool set
    # directly from the provider, bypassing that filtering.
    tools = await Provider.list_tools(mcp)
    return McpStatus(
        enabled=True,
        path="/mcp",
        tool_count=len(tools),
        tools=[McpToolInfo(name=tool.name, description=tool.description or "") for tool in tools],
    )
