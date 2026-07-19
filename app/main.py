import time
import uuid
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api.v1.router import api_router
from app.config import get_settings
from app.database import get_engine
from app.exceptions import register_exception_handlers
from app.logging_config import access_logger, setup_logging
from app.schemas.common import HealthResponse

settings = get_settings()
setup_logging(settings.LOG_LEVEL)

STATIC_DIR = Path(__file__).parent / "static"
ACTION_PATH_ALIASES = {
    "/workout-plans": "/api/v1/plans",
    "/workout-logs": "/api/v1/logs",
}

openapi_servers = [{"url": settings.PUBLIC_BASE_URL}] if settings.PUBLIC_BASE_URL else None

app = FastAPI(
    title="Workout Logger & Planner API",
    version=settings.APP_VERSION,
    docs_url="/docs",
    openapi_url="/openapi.json",
    servers=openapi_servers,
)

CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self'; "
    "img-src 'self' data:; "
    "connect-src 'self'; "
    "manifest-src 'self'; "
    "worker-src 'self'; "
    "object-src 'none'; "
    "base-uri 'none'; "
    "frame-ancestors 'none'"
)


@app.middleware("http")
async def action_path_alias_middleware(request: Request, call_next):
    path = request.scope.get("path", "")
    for alias, target in ACTION_PATH_ALIASES.items():
        if path == alias or path.startswith(f"{alias}/"):
            request.scope["path"] = f"{target}{path.removeprefix(alias)}"
            request.scope["root_path"] = request.scope.get("root_path", "")
            break
    return await call_next(request)


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@app.middleware("http")
async def request_id_and_access_log_middleware(request: Request, call_next):
    request.state.request_id = str(uuid.uuid4())
    started_at = time.monotonic()
    response = await call_next(request)
    duration_ms = round((time.monotonic() - started_at) * 1000, 2)
    response.headers["X-Request-ID"] = request.state.request_id
    access_logger.info(
        "request completed",
        extra={
            "request_id": request.state.request_id,
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "duration_ms": duration_ms,
        },
    )
    return response


register_exception_handlers(app)
app.include_router(api_router)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get(
    "/health",
    include_in_schema=True,
    summary="Health check",
    response_model=HealthResponse,
    responses={503: {"model": HealthResponse, "description": "Database unavailable"}},
)
async def health() -> JSONResponse:
    try:
        engine = get_engine()
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(
            status_code=503,
            content={"status": "error", "database": "unavailable", "version": settings.APP_VERSION},
        )
    return JSONResponse(content={"status": "ok", "database": "ok", "version": settings.APP_VERSION})


@app.get("/", include_in_schema=False)
async def root() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html", media_type="text/html")


@app.get("/manifest.webmanifest", include_in_schema=False)
async def manifest() -> FileResponse:
    return FileResponse(STATIC_DIR / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/sw.js", include_in_schema=False)
async def service_worker() -> FileResponse:
    return FileResponse(STATIC_DIR / "sw.js", media_type="application/javascript")
