import os
import tempfile
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

os.environ.setdefault("API_KEY", "test-api-key-with-at-least-32-characters")
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("PUBLIC_BASE_URL", "https://fitness.example.test")

_app_db_fd, _APP_DB_PATH = tempfile.mkstemp(suffix=".db")
os.close(_app_db_fd)
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_APP_DB_PATH}"

# MCP OAuth: exercised with FastMCP's "jwt" resource-server verifier rather
# than the real Auth0 proxy, so the suite never depends on network access.
# It validates the same claims (iss/aud/exp/sig/scopes) and the same
# allowlist wrapper (`app.mcp.oauth.SubjectAllowlistAuth`) that production
# uses; only the client-registration bridge to Auth0 itself is untested here
# (see the "Manual OAuth Provider Setup"/MCP Inspector section in the PR).
from fastmcp.server.auth.providers.jwt import RSAKeyPair  # noqa: E402

TEST_MCP_OAUTH_ISSUER = "https://idp.example.test/"
TEST_MCP_OAUTH_AUDIENCE = "https://fitness.example.test/mcp/"
TEST_MCP_OAUTH_ALLOWED_SUBJECT = "auth0|test-allowed-user"
_MCP_OAUTH_KEY_PAIR = RSAKeyPair.generate()

os.environ.setdefault("MCP_OAUTH_ENABLED", "true")
os.environ.setdefault("MCP_OAUTH_PROVIDER", "jwt")
os.environ.setdefault("MCP_OAUTH_ISSUER", TEST_MCP_OAUTH_ISSUER)
os.environ.setdefault("MCP_OAUTH_AUDIENCE", TEST_MCP_OAUTH_AUDIENCE)
os.environ.setdefault("MCP_OAUTH_JWT_PUBLIC_KEY", _MCP_OAUTH_KEY_PAIR.public_key)
os.environ.setdefault("MCP_OAUTH_ALLOWED_SUBJECTS", TEST_MCP_OAUTH_ALLOWED_SUBJECT)

from app.database import create_engine  # noqa: E402
from app.models import Base  # noqa: E402

TEST_API_KEY = os.environ["API_KEY"]


def mint_mcp_oauth_token(
    *,
    subject: str = TEST_MCP_OAUTH_ALLOWED_SUBJECT,
    scopes: list[str] | None = None,
    issuer: str = TEST_MCP_OAUTH_ISSUER,
    audience: str = TEST_MCP_OAUTH_AUDIENCE,
    expires_in_seconds: int = 3600,
) -> str:
    """Mint a JWT signed by the test issuer's key, shaped like the access
    token FastMCP's OAuth proxy would hand an MCP client after a real
    Authorization Code + PKCE exchange against Auth0."""
    return _MCP_OAUTH_KEY_PAIR.create_token(
        subject=subject,
        issuer=issuer,
        audience=audience,
        scopes=scopes if scopes is not None else ["read", "log"],
        expires_in_seconds=expires_in_seconds,
    )


@pytest_asyncio.fixture
async def db_engine() -> AsyncIterator:
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    engine = create_engine(f"sqlite+aiosqlite:///{path}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()
    os.remove(path)


@pytest_asyncio.fixture
async def db_session(db_engine) -> AsyncIterator[AsyncSession]:
    session_maker = async_sessionmaker(db_engine, expire_on_commit=False, autoflush=False)
    async with session_maker() as session:
        yield session


@pytest_asyncio.fixture
async def app_engine() -> AsyncIterator:
    """The same engine app.main's FastAPI app will use (shared DATABASE_URL)."""
    from app.database import get_engine

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(table.delete())


@pytest_asyncio.fixture
async def client(app_engine) -> AsyncIterator[AsyncClient]:
    from app.main import app

    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {"X-API-Key": TEST_API_KEY}


@pytest.fixture
def mcp_bearer_headers() -> dict[str, str]:
    token = mint_mcp_oauth_token()
    return {"Authorization": f"Bearer {token}"}
