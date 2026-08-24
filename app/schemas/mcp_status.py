from pydantic import BaseModel


class McpToolInfo(BaseModel):
    name: str
    description: str


class McpStatus(BaseModel):
    enabled: bool
    path: str
    tool_count: int
    tools: list[McpToolInfo]
