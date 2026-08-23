from fastapi import APIRouter

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
    tools = await mcp.list_tools()
    return McpStatus(
        enabled=True,
        path="/mcp",
        tool_count=len(tools),
        tools=[McpToolInfo(name=tool.name, description=tool.description or "") for tool in tools],
    )
