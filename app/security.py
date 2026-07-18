import secrets

from fastapi import Security
from fastapi.security import APIKeyHeader
from starlette.exceptions import HTTPException

from app.config import get_settings

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def require_api_key(api_key: str | None = Security(api_key_header)) -> str:
    settings = get_settings()
    if not api_key or not secrets.compare_digest(api_key, settings.API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
    return api_key
