"""The one read an assistant needs before planning: profile and hard
constraints, equipment, the last N days of training and recovery, and the
current meal plan with adherence. Kept compact on purpose."""

from collections import Counter
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Location, ScheduledWorkout, SleepEntry, WorkoutLog
from app.models.base import utcnow
from app.schemas.coach import (
    AdherenceDay,
    CoachingContext,
    ContextLocation,
    ContextNutrition,
    ContextProfile,
    ContextReadiness,
    ContextSession,
    ContextTotals,
    ContextTraining,
    ContextWindow,
    ExerciseTrend,
    MacroTotals,
    RecoveryDeficits,
    TrendPoint,
    UpcomingItem,
)
from app.schemas.meal_plans import DayPlanRead, SupplementRead
from app.schemas.readiness import ReadinessLogRead
from app.services import coaching_principles as principles_service
from app.services import meal_plans as meal_plans_service
from app.services import progression, readiness_score
from app.services import supplements as supplements_service
from app.services.athlete_profile import get_profile
from app.services.exercise_baseline import recent_sessions
from app.services.load_events import get_occurrences
from app.services.nutrition_dashboard import get_daily_summary
from app.services.readiness import list_readiness_logs
from app.services.volume_rules import apply_to_logs

MAX_TRENDS = 12
UPCOMING_DAYS = 7
PLAN_LOOKAHEAD_DAYS = 2
SORE_REPORT_LEVEL = 6
SHORT_SLEEP_SECONDS = 7 * 3600


def top_set_text(reps: list[int], weight_kg: float | None) -> str:
    if not reps:
        return "no sets"
    shape = f"{len(reps)}x{reps[0]}" if len(set(reps)) == 1 else "/".join(map(str, reps))
    return f"{shape} @ {weight_kg:g} kg" if weight_kg else f"{shape} reps"


def _pct(value: float, target: float | None) -> int | None:
    if not target:
        return None
    return round(100 * value / target)


async def _logs(session: AsyncSession, start: date, end: date) -> list[WorkoutLog]:
    logs = list(
        (
            await session.scalars(
                select(WorkoutLog)
                .options(selectinload(WorkoutLog.exercises))
                .where(
                    WorkoutLog.performed_at >= datetime.combine(start, time.min, tzinfo=UTC),
                    WorkoutLog.performed_at
                    < datetime.combine(end + timedelta(days=1), time.min, tzinfo=UTC),
                )
                .order_by(WorkoutLog.performed_at)
            )
        ).all()
    )
    await apply_to_logs(session, logs)
    return logs


def _session(log: WorkoutLog) -> ContextSession:
    return ContextSession(
        date=log.performed_at.date(),
        kind=log.activity_type or "strength",
        name=log.source_plan_name,
        minutes=log.total_time_minutes,
        rpe=log.effort_rpe,
        load_au=log.effort_rpe * log.total_time_minutes if log.effort_rpe else None,
        volume_kg=log.total_volume_kg,
        laps=log.laps,
        sauna_rounds=log.sauna_rounds,
    )


async def _trends(session: AsyncSession, logs: list[WorkoutLog]) -> list[ExerciseTrend]:
    counts = Counter(
        exercise.exercise_name.strip()
        for log in logs
        if log.activity_type is None
        for exercise in log.exercises
    )
    trends = []
    for name, _ in counts.most_common(MAX_TRENDS):
        sessions = await recent_sessions(session, name)
        points = [
            TrendPoint(
                date=item.date,
                top_set=top_set_text(item.reps_per_set, item.top_set_kg),
                e1rm_kg=item.e1rm_kg,
            )
            for item in sessions
        ]
        e1rms = [point.e1rm_kg for point in points if point.e1rm_kg is not None]
        change = round(e1rms[0] - e1rms[-1], 1) if len(e1rms) > 1 else None
        trends.append(ExerciseTrend(exercise=name, sessions=points, e1rm_change_kg=change))
    return trends


async def _upcoming(session: AsyncSession, today: date) -> list[UpcomingItem]:
    last = today + timedelta(days=UPCOMING_DAYS)
    scheduled = (
        await session.scalars(
            select(ScheduledWorkout)
            .options(selectinload(ScheduledWorkout.workout_plan))
            .where(
                ScheduledWorkout.scheduled_date >= today, ScheduledWorkout.scheduled_date <= last
            )
            .order_by(ScheduledWorkout.scheduled_date)
        )
    ).all()
    items = [
        UpcomingItem(
            date=item.scheduled_date,
            kind="workout",
            name=item.workout_plan_name,
            status=item.status,
        )
        for item in scheduled
    ]
    items.extend(
        UpcomingItem(date=item.date, kind=f"hockey_{item.kind}", name=item.name, status=None)
        for item in await get_occurrences(session, today, last)
    )
    return sorted(items, key=lambda item: (item.date, item.kind))


async def _sleep(session: AsyncSession, start: date, end: date) -> tuple[float | None, int]:
    entries = (
        await session.scalars(
            select(SleepEntry).where(
                SleepEntry.sleep_end >= datetime.combine(start, time.min, tzinfo=UTC),
                SleepEntry.sleep_end
                < datetime.combine(end + timedelta(days=1), time.min, tzinfo=UTC),
            )
        )
    ).all()
    seconds = [entry.estimated_sleep_seconds or entry.time_in_bed_seconds for entry in entries]
    if not seconds:
        return None, 0
    average = round(sum(seconds) / len(seconds) / 3600, 1)
    return average, sum(1 for value in seconds if value < SHORT_SLEEP_SECONDS)


async def build_context(
    session: AsyncSession, days: int = 7, today: date | None = None
) -> CoachingContext:
    end = today or utcnow().date()
    start = end - timedelta(days=days - 1)
    profile = await get_profile(session)
    principles = await principles_service.get_principles(session)
    locations = (await session.scalars(select(Location).order_by(Location.name))).all()
    logs = await _logs(session, start, end)
    sessions = [_session(log) for log in logs]
    strength = [log for log in logs if log.activity_type is None]

    readiness_logs = await list_readiness_logs(session, start, end)
    recent = [ReadinessLogRead.model_validate(log) for log in readiness_logs]
    latest = recent[0] if recent else None
    sore_since = utcnow() - timedelta(hours=72)
    sore = sorted(
        {
            muscle
            for log in readiness_logs
            if log.logged_at >= sore_since and (log.soreness or 0) >= SORE_REPORT_LEVEL
            for muscle in log.sore_muscle_groups
        }
    )
    avg_sleep, short_nights = await _sleep(session, start, end)

    plans = await meal_plans_service.list_days(
        session, start, end + timedelta(days=PLAN_LOOKAHEAD_DAYS)
    )
    plans_by_date = {plan.plan_date: plan for plan in plans}
    adherence = []
    for offset in range(days):
        day = start + timedelta(days=offset)
        summary = await get_daily_summary(session, day)
        day_plan = plans_by_date.get(day)
        energy_target = (
            day_plan.energy_target_kcal
            if day_plan
            else (summary.target.energy_target_kcal if summary.target else None)
        )
        protein_target = (
            day_plan.protein_target_g
            if day_plan
            else (summary.target.protein_target_g if summary.target else None)
        )
        adherence.append(
            AdherenceDay(
                date=day,
                eaten=MacroTotals(
                    energy_kcal=round(summary.totals.energy_kcal, 1),
                    protein_g=round(summary.totals.protein_g, 1),
                    fiber_g=round(summary.totals.fiber_g, 1),
                ),
                target_energy_kcal=energy_target,
                target_protein_g=protein_target,
                energy_pct=_pct(summary.totals.energy_kcal, energy_target),
                protein_pct=_pct(summary.totals.protein_g, protein_target),
            )
        )

    return CoachingContext(
        generated_at=utcnow(),
        window=ContextWindow(start=start, end=end, days=days),
        profile=ContextProfile(
            display_name=profile.display_name,
            birth_year=profile.birth_year,
            goals=profile.longevity_goals,
            dietary_constraints=profile.dietary_constraints,
            physical_constraints=profile.physical_constraints,
        ),
        coaching_principles=principles.body,
        equipment=[
            ContextLocation(location=item.name, kind=item.kind, equipment=list(item.equipment))
            for item in locations
        ],
        training=ContextTraining(
            sessions=sessions,
            totals=ContextTotals(
                strength_sessions=len(strength),
                strength_volume_kg=round(sum(log.total_volume_kg for log in strength), 1),
                hockey_sessions=sum(1 for log in logs if log.activity_type == "ice_hockey"),
                swim_sessions=sum(1 for log in logs if log.activity_type == "swimming"),
                load_au=sum(item.load_au or 0 for item in sessions),
            ),
            exercise_trends=await _trends(session, logs),
            upcoming=await _upcoming(session, end),
        ),
        readiness=ContextReadiness(
            latest=latest,
            today_score=latest.score if latest and latest.log_date == end else None,
            load_factor=latest.load_factor if latest and latest.log_date == end else None,
            recent=recent,
            deficits=RecoveryDeficits(
                sore_muscles=sore, avg_sleep_hours=avg_sleep, short_sleep_nights=short_nights
            ),
        ),
        nutrition=ContextNutrition(
            plans=[DayPlanRead.model_validate(plan) for plan in plans if plan.plan_date >= end],
            adherence=adherence,
            supplements=[
                SupplementRead.model_validate(item)
                for item in await supplements_service.list_active(session)
            ],
        ),
        rules={
            "readiness": readiness_score.__doc__ or "",
            "progression": progression.__doc__ or "",
            "coach_targets": (
                "Targets written with upsert_adaptive_workout_plan are used as written; a "
                "check-in logged after them scales the load by its factor."
            ),
            "dietary_constraints": (
                "Severe and strict constraints are hard exclusions; the server rejects meal "
                "plans whose ingredients match their match_terms. Constraints with an empty "
                "match_terms list are only enforced by you."
            ),
        },
    )
