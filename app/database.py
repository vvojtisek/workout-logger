from collections.abc import AsyncGenerator
from functools import lru_cache

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import ConnectionPoolEntry

from app.config import get_settings


def _set_sqlite_pragma(dbapi_connection, connection_record: ConnectionPoolEntry) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys = ON")
    cursor.execute("PRAGMA journal_mode = WAL")
    cursor.execute("PRAGMA busy_timeout = 5000")
    cursor.execute("PRAGMA synchronous = NORMAL")
    cursor.close()


def create_engine(database_url: str | None = None) -> AsyncEngine:
    url = database_url or get_settings().DATABASE_URL
    engine = create_async_engine(url)
    event.listen(engine.sync_engine, "connect", _set_sqlite_pragma)
    return engine


@lru_cache
def get_engine() -> AsyncEngine:
    """Lazily built default engine, read from settings at first use (not import time)."""
    return create_engine()


def get_session_maker(engine: AsyncEngine | None = None) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        engine or get_engine(),
        expire_on_commit=False,
        autoflush=False,
    )


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with get_session_maker()() as session:
        yield session
