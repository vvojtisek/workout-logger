import csv
import io
import json
import zipfile
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ScheduledWorkout, StepCount
from app.schemas.body_metrics import BodyMetricRead
from app.schemas.exercises import ExerciseRead
from app.schemas.foods import FoodRead
from app.schemas.ingest import StepCountRead
from app.schemas.logs import WorkoutLogRead
from app.schemas.meal_entries import MealEntryRead
from app.schemas.nutrition_plans import NutritionPlanRead
from app.schemas.plans import WorkoutPlanRead
from app.schemas.programs import ProgramRead
from app.schemas.scheduled_workouts import ScheduledWorkoutRead
from app.schemas.sleep_entries import SleepEntryRead
from app.services import body_metrics as body_metrics_service
from app.services import exercises as exercises_service
from app.services import foods as foods_service
from app.services import logs as logs_service
from app.services import meal_entries as meal_entries_service
from app.services import nutrition_plans as nutrition_plans_service
from app.services import plans as plans_service
from app.services import programs as programs_service
from app.services import sleep_entries as sleep_entries_service

# Personal-scale export, not a paginated API: every domain is small enough
# (single-user today, 5-6 family users later) to fetch in one page.
_EXPORT_LIMIT = 100_000


async def _scheduled_workouts(session: AsyncSession) -> list[ScheduledWorkoutRead]:
    result = await session.execute(
        select(ScheduledWorkout).order_by(ScheduledWorkout.scheduled_date.desc())
    )
    return [ScheduledWorkoutRead.model_validate(row) for row in result.scalars().all()]


async def _step_counts(session: AsyncSession) -> list[StepCountRead]:
    result = await session.execute(select(StepCount).order_by(StepCount.recorded_date.desc()))
    return [StepCountRead.model_validate(row) for row in result.scalars().all()]


async def gather_export(session: AsyncSession) -> dict[str, list[Any]]:
    """Every domain that represents a personal record. Deliberately excludes
    api_tokens (credential metadata, not health/fitness data) and the
    in-progress workout_sessions state (its completed form already lands in
    `sessions` once finished)."""
    plans, _ = await plans_service.list_plans(session, _EXPORT_LIMIT, 0)
    exercises, _ = await exercises_service.list_exercises(session, _EXPORT_LIMIT, 0)
    programs, _ = await programs_service.list_programs(session, _EXPORT_LIMIT, 0)
    sessions, _ = await logs_service.list_logs(session, _EXPORT_LIMIT, 0)
    body_metrics, _ = await body_metrics_service.list_body_metrics(session, _EXPORT_LIMIT, 0)
    foods, _ = await foods_service.list_foods(session, _EXPORT_LIMIT, 0)
    nutrition_plans, _ = await nutrition_plans_service.list_nutrition_plans(
        session, _EXPORT_LIMIT, 0
    )
    meal_entries, _ = await meal_entries_service.list_meal_entries(session, _EXPORT_LIMIT, 0)
    sleep_entries, _ = await sleep_entries_service.list_sleep_entries(session, _EXPORT_LIMIT, 0)

    return {
        "plans": [WorkoutPlanRead.model_validate(p) for p in plans],
        "exercises": [ExerciseRead.model_validate(e) for e in exercises],
        "programs": [ProgramRead.model_validate(p) for p in programs],
        "scheduled_workouts": await _scheduled_workouts(session),
        "sessions": [WorkoutLogRead.model_validate(s) for s in sessions],
        "body_metrics": [BodyMetricRead.model_validate(m) for m in body_metrics],
        "foods": [FoodRead.model_validate(f) for f in foods],
        "nutrition_plans": [NutritionPlanRead.model_validate(n) for n in nutrition_plans],
        "meal_entries": [MealEntryRead.model_validate(m) for m in meal_entries],
        "sleep_entries": [SleepEntryRead.model_validate(s) for s in sleep_entries],
        "step_counts": await _step_counts(session),
    }


def to_json(data: dict[str, list[Any]]) -> dict[str, list[dict[str, Any]]]:
    return {domain: [row.model_dump(mode="json") for row in rows] for domain, rows in data.items()}


def _flatten_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        key: json.dumps(value) if isinstance(value, list | dict) else value
        for key, value in row.items()
    }


def to_csv_zip(data: dict[str, list[Any]]) -> bytes:
    """One CSV per domain inside a zip. Nested fields (a plan's exercises, a
    meal's items) are JSON-encoded into their own cell rather than split into
    a second file - simple to read back, no join needed for the common case
    of skimming one domain at a time."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for domain, rows in data.items():
            csv_buffer = io.StringIO()
            dicts = [_flatten_row(row.model_dump(mode="json")) for row in rows]
            fieldnames = list(dicts[0].keys()) if dicts else []
            writer = csv.DictWriter(csv_buffer, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(dicts)
            archive.writestr(f"{domain}.csv", csv_buffer.getvalue())
    return buffer.getvalue()
