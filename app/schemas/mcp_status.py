from datetime import datetime
from typing import Literal

from pydantic import BaseModel

McpMode = Literal["disabled", "read_only", "read_write"]


class McpToolInfo(BaseModel):
    name: str
    description: str


class McpOAuthClientInfo(BaseModel):
    client_id: str
    client_name: str | None
    scopes: list[str]
    created_at: datetime
    last_used_at: datetime | None


class McpStatus(BaseModel):
    enabled: bool
    mode: McpMode = "read_write"
    oauth_enabled: bool = False
    path: str
    tool_count: int
    tools: list[McpToolInfo]
    pairing_window_expires_at: datetime | None = None
    clients: list[McpOAuthClientInfo] | None = None


class PairingWindowResponse(BaseModel):
    pairing_window_expires_at: datetime | None
