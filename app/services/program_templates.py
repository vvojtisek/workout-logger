from datetime import date, timedelta
from functools import cache
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import AppError, ConflictError, NotFoundError
from app.models import PlanExercise, Program, ScheduledWorkout, WorkoutPlan
from app.schemas.program_templates import (
    ProgramTemplate,
    ProgramTemplateInstall,
    ProgramTemplateRead,
)

TEMPLATE_DIR = Path(__file__).resolve().parents[1] / "program_templates"


@cache
def load_templates() -> dict[str, ProgramTemplate]:
    templates = [
        ProgramTemplate.model_validate_json(path.read_text(encoding="utf-8"))
        for path in sorted(TEMPLATE_DIR.glob("*.json"))
    ]
    return {template.key: template for template in templates}


def to_read(template: ProgramTemplate) -> ProgramTemplateRead:
    schedule = template.schedule
    sequence = schedule if schedule.type == "sequence" else None
    return ProgramTemplateRead(
        key=template.key,
        name=template.name,
        kind=template.kind,
        location=template.location,
        summary=template.summary,
        schedule_type=schedule.type,
        session_count=template.session_count,
        max_sessions_per_week=sequence.max_sessions_per_week if sequence else None,
        default_weekdays=sequence.default_weekdays if sequence else None,
        plan_names=[plan.name for plan in template.plans],
    )


def get_template(key: str) -> ProgramTemplate:
    template = load_templates().get(key)
    if template is None:
        raise NotFoundError("Program template not found", code="PROGRAM_TEMPLATE_NOT_FOUND")
    return template


def _dated_sessions(
    template: ProgramTemplate, data: ProgramTemplateInstall
) -> list[tuple[date, str, str]]:
    """Returns (date, plan key, note) for every session the template schedules."""
    schedule = template.schedule
    if schedule.type == "weekly":
        monday = data.start_date + timedelta(days=(7 - data.start_date.weekday()) % 7)
        return [
            (monday + timedelta(weeks=week.week - 1, days=weekday), plan_key, week.note)
            for week in schedule.weeks
            for weekday, plan_key in sorted(week.days.items())
        ]

    weekdays = data.weekdays or schedule.default_weekdays
    if len(weekdays) > schedule.max_sessions_per_week:
        raise AppError(
            422,
            f"This program allows at most {schedule.max_sessions_per_week} sessions a week",
            "PROGRAM_TEMPLATE_TOO_MANY_WEEKDAYS",
        )
    sessions = []
    day = data.start_date
    for session in schedule.sessions:
        while day.weekday() not in weekdays:
            day += timedelta(days=1)
        sessions.append((day, session.plan, session.note))
        day += timedelta(days=1)
    return sessions


async def install_template(
    session: AsyncSession, key: str, data: ProgramTemplateInstall
) -> tuple[Program, list[WorkoutPlan], int]:
    """Copies a template into the caller's account: its plans, a program and its calendar."""
    template = get_template(key)
    sessions = _dated_sessions(template, data)

    names = [plan.name.lower() for plan in template.plans]
    existing = await session.scalar(
        select(func.count()).select_from(WorkoutPlan).where(func.lower(WorkoutPlan.name).in_(names))
    )
    if existing:
        raise ConflictError(
            "This program is already in your plans. Delete its plans to add it again.",
            code="PROGRAM_TEMPLATE_ALREADY_INSTALLED",
        )

    plans: dict[str, WorkoutPlan] = {}
    for template_plan in template.plans:
        plan = WorkoutPlan(name=template_plan.name, description=template_plan.description)
        for index, exercise in enumerate(template_plan.exercises):
            plan.exercises.append(PlanExercise(sort_order=index, **exercise.model_dump()))
        session.add(plan)
        plans[template_plan.key] = plan

    program = Program(
        name=template.name,
        kind=template.kind,
        start_date=sessions[0][0],
        end_date=sessions[-1][0],
        status="active",
        notes=template.notes,
    )
    session.add(program)
    await session.flush()

    for scheduled_date, plan_key, note in sessions:
        session.add(
            ScheduledWorkout(
                program_id=program.id,
                workout_plan_id=plans[plan_key].id,
                scheduled_date=scheduled_date,
                status="scheduled",
                notes=note,
            )
        )
    await session.commit()
    await session.refresh(program)
    return program, list(plans.values()), len(sessions)
