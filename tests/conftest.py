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

from app.database import create_engine  # noqa: E402
from app.models import Base  # noqa: E402

TEST_API_KEY = os.environ["API_KEY"]


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
