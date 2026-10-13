from collections.abc import AsyncGenerator
from functools import lru_cache

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import Session, with_loader_criteria
from sqlalchemy.pool import ConnectionPoolEntry

from app.config import get_settings
from app.models import (
    ApiToken,
    BodyMetric,
    Exercise,
    Food,
    MealEntry,
    NutritionPlan,
    Program,
    ScheduledWorkout,
    SleepEntry,
    StepCount,
    UserSettings,
    WorkoutLog,
    WorkoutPlan,
    WorkoutSession,
)

_OWNED_MODELS = (
    ApiToken,
    BodyMetric,
    Exercise,
    Food,
    MealEntry,
    NutritionPlan,
    Program,
    ScheduledWorkout,
    SleepEntry,
    StepCount,
    UserSettings,
    WorkoutLog,
    WorkoutPlan,
    WorkoutSession,
)
_SHARED_CATALOG_MODELS = (Exercise,)


@event.listens_for(Session, "do_orm_execute")
def _scope_owned_record_queries(execute_state) -> None:
    session = execute_state.session
    if "data_owner_id" not in session.info:
        return
    if session.info.get("data_global_access"):
        return
    owner_id = session.info["data_owner_id"]

    statement = execute_state.statement
    if execute_state.is_update or execute_state.is_delete:
        mapper = execute_state.bind_mapper
        model = mapper.class_ if mapper is not None else None
        if model in _OWNED_MODELS:
            condition = model.owner_id == owner_id
            if owner_id is None:
                condition = model.owner_id.is_(None)
            statement = statement.where(condition)
            execute_state.statement = statement
        return

    for model in _OWNED_MODELS:
        condition = model.owner_id == owner_id if owner_id is not None else model.owner_id.is_(None)
        if session.info.get("data_read_shared") and model in _SHARED_CATALOG_MODELS:
            condition = condition | model.owner_id.is_(None)
        statement = statement.options(with_loader_criteria(model, condition, include_aliases=True))
    execute_state.statement = statement


@event.listens_for(Session, "before_flush")
def _assign_owned_record_inserts(session: Session, flush_context, instances) -> None:
    owner_id = session.info.get("data_owner_id")
    if owner_id is None:
        return
    for item in session.new:
        if isinstance(item, _OWNED_MODELS) and item.owner_id is None:
            item.owner_id = owner_id


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
