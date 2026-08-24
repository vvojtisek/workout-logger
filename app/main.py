import time
import uuid
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api.v1.auth import router as auth_router
from app.api.v1.router import api_router
from app.config import get_settings
from app.database import get_engine
from app.exceptions import register_exception_handlers
from app.logging_config import access_logger, setup_logging
from app.mcp import mcp
from app.schemas.common import HealthResponse

settings = get_settings()
setup_logging(settings.LOG_LEVEL)

STATIC_DIR = Path(__file__).parent / "static"
# The single-page application is compiled by Vite into `static/dist`. It is a
# build artifact rather than source, so it is absent until `npm run build` runs.
SPA_DIR = STATIC_DIR / "dist"
SPA_INDEX = SPA_DIR / "index.html"
ACTION_PATH_ALIASES = {
    "/workout-plans": "/api/v1/plans",
    "/workout-logs": "/api/v1/logs",
}

openapi_servers = [{"url": settings.PUBLIC_BASE_URL}] if settings.PUBLIC_BASE_URL else None

# Built before the FastAPI app so its session-manager lifespan can be adopted
# below; without that the streamable-HTTP transport is never started.
mcp_app = mcp.http_app(path="/")

app = FastAPI(
    title="Workout Logger & Planner API",
    version=settings.APP_VERSION,
    docs_url="/docs",
    openapi_url="/openapi.json",
    servers=openapi_servers,
    lifespan=mcp_app.lifespan,
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
# Deliberately NOT included via api_router: these routes (invite acceptance,
# and login/logout/me once slice 2 lands) must be reachable without any
# prior auth, so they can't sit behind api_router's blanket X-API-Key gate.
app.include_router(auth_router, prefix="/api/v1")


@app.get("/mcp", include_in_schema=False)
async def mcp_bare_path_redirect() -> RedirectResponse:
    """The canonical MCP resource identifier has a trailing slash (`/mcp/`).
    Redirect the bare path instead of 404ing so it never becomes a second,
    subtly different OAuth resource in metadata or client configuration."""
    return RedirectResponse(url="/mcp/", status_code=308)


# The MCP transport authenticates OAuth bearer tokens itself (FastMCP's
# AuthProvider), rather than through the REST routers' X-API-Key dependency.
app.mount("/mcp", mcp_app)

# RFC 9728/8414 discovery metadata (`/.well-known/oauth-protected-resource`,
# `/.well-known/oauth-authorization-server`, ...) must be reachable at the
# domain root, not underneath the `/mcp` mount -- MCP/OAuth clients always
# look there first, regardless of where the resource itself lives. FastMCP
# already builds these routes into `mcp_app`, but nested under `/mcp` they'd
# be unreachable at their required root-level path, so the same routes are
# also registered directly on the outer app.
if mcp.auth is not None:
    for well_known_route in mcp.auth.get_well_known_routes(mcp_path="/"):
        app.router.routes.append(well_known_route)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get(
    "/health",
    include_in_schema=True,
    summary="Health check",
    response_model=HealthResponse,
    responses={503: {"model": HealthResponse, "description": "Database unavailable"}},
)
async def health() -> JSONResponse:
    """Compatibility readiness check for existing clients."""
    return await dependency_health()


async def dependency_health() -> JSONResponse:
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


@app.get(
    "/health/live",
    summary="Liveness check",
    response_model=HealthResponse,
)
async def health_live() -> JSONResponse:
    return JSONResponse(
        content={
            "status": "ok",
            "database": "not_checked",
            "version": settings.APP_VERSION,
        }
    )


@app.get(
    "/health/ready",
    summary="Readiness check",
    response_model=HealthResponse,
    responses={503: {"model": HealthResponse, "description": "Database unavailable"}},
)
async def health_ready() -> JSONResponse:
    return await dependency_health()


@app.get(
    "/health/startup",
    summary="Startup check",
    response_model=HealthResponse,
    responses={503: {"model": HealthResponse, "description": "Database unavailable"}},
)
async def health_startup() -> JSONResponse:
    return await dependency_health()


@app.get("/manifest.webmanifest", include_in_schema=False)
async def manifest() -> FileResponse:
    return FileResponse(STATIC_DIR / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/sw.js", include_in_schema=False)
async def service_worker() -> FileResponse:
    return FileResponse(STATIC_DIR / "sw.js", media_type="application/javascript")


SPA_PREFIX_BLACKLIST = (
    "/api/",
    "/mcp",
    "/static/",
    "/health",
    "/docs",
    "/openapi.json",
    "/sw.js",
    "/manifest.webmanifest",
    "/.well-known/",
)


@app.get("/{full_path:path}", include_in_schema=False, response_model=None)
async def spa_catch_all(full_path: str) -> FileResponse | JSONResponse:
    request_path = f"/{full_path}"
    if any(request_path.startswith(prefix) for prefix in SPA_PREFIX_BLACKLIST):
        return JSONResponse(status_code=404, content={"detail": "Not Found"})
    if not SPA_INDEX.is_file():
        raise RuntimeError(
            "The frontend bundle is missing. Run `npm ci && npm run build` to compile it "
            f"into {SPA_DIR}."
        )
    return FileResponse(SPA_INDEX, media_type="text/html")
