from fastapi import APIRouter, Security

from app.api.v1 import logs, plans
from app.security import require_api_key

api_router = APIRouter(prefix="/api/v1", dependencies=[Security(require_api_key)])
api_router.include_router(plans.router)
api_router.include_router(logs.router)
