from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.schemas.logs import ExerciseLogCreate, WorkoutLogCreate
from app.schemas.plans import PlanExerciseCreate, WorkoutPlanCreate


def valid_plan_exercise(**overrides) -> dict:
    data = {
        "exercise_name": "Squat",
        "target_sets": 3,
        "target_reps_min": 5,
        "target_reps_max": 8,
    }
    data.update(overrides)
    return data


def valid_exercise_log(**overrides) -> dict:
    data = {
        "exercise_name": "Bench Press",
        "sets_count": 3,
        "reps_per_set": [10, 10, 8],
        "weight_kg": 80,
    }
    data.update(overrides)
    return data


def valid_workout_log(**overrides) -> dict:
    data = {
        "performed_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        "total_time_minutes": 45,
        "overall_feeling": 4,
        "exercises": [],
    }
    data.update(overrides)
    return data


def test_performed_at_without_timezone_is_rejected():
    with pytest.raises(ValidationError, match="timezone"):
        WorkoutLogCreate(**valid_workout_log(performed_at=datetime(2026, 1, 1)))


def test_performed_at_is_normalized_to_utc():
    from datetime import timedelta

    plus_two = timezone(timedelta(hours=2))
    local_dt = datetime(2026, 1, 1, 10, 0, tzinfo=plus_two)
    log = WorkoutLogCreate(**valid_workout_log(performed_at=local_dt))
    assert log.performed_at.tzinfo == timezone.utc
    assert log.performed_at.hour == 8


def test_negative_target_weight_rejected():
    with pytest.raises(ValidationError):
        PlanExerciseCreate(**valid_plan_exercise(target_weight_kg=-1))


def test_negative_exercise_log_weight_rejected():
    with pytest.raises(ValidationError):
        ExerciseLogCreate(**valid_exercise_log(weight_kg=-5))


def test_zero_sets_count_rejected():
    with pytest.raises(ValidationError):
        ExerciseLogCreate(**valid_exercise_log(sets_count=0, reps_per_set=[]))


def test_sets_count_mismatch_with_reps_per_set_rejected():
    with pytest.raises(ValidationError, match="sets_count"):
        ExerciseLogCreate(**valid_exercise_log(sets_count=3, reps_per_set=[10, 10]))


def test_empty_reps_per_set_rejected():
    with pytest.raises(ValidationError, match="reps_per_set"):
        ExerciseLogCreate(**valid_exercise_log(sets_count=0, reps_per_set=[]))


def test_zero_or_negative_reps_in_set_rejected():
    with pytest.raises(ValidationError):
        ExerciseLogCreate(**valid_exercise_log(sets_count=3, reps_per_set=[10, 0, 8]))


def test_blank_exercise_name_rejected():
    with pytest.raises(ValidationError):
        PlanExerciseCreate(**valid_plan_exercise(exercise_name="   "))


def test_blank_plan_name_rejected():
    with pytest.raises(ValidationError):
        WorkoutPlanCreate(name="   ")


def test_overall_feeling_out_of_range_rejected():
    with pytest.raises(ValidationError):
        WorkoutLogCreate(**valid_workout_log(overall_feeling=6))
    with pytest.raises(ValidationError):
        WorkoutLogCreate(**valid_workout_log(overall_feeling=0))


def test_negative_calories_rejected():
    with pytest.raises(ValidationError):
        WorkoutLogCreate(**valid_workout_log(calories_burned=-10))


def test_notes_too_long_rejected():
    with pytest.raises(ValidationError):
        WorkoutLogCreate(**valid_workout_log(notes="x" * 10001))


def test_description_too_long_rejected():
    with pytest.raises(ValidationError):
        WorkoutPlanCreate(name="Valid Name", description="x" * 4001)


def test_target_reps_max_below_min_rejected():
    with pytest.raises(ValidationError, match="target_reps_max"):
        PlanExerciseCreate(**valid_plan_exercise(target_reps_min=10, target_reps_max=5))


def test_target_reps_max_equal_min_is_allowed():
    exercise = PlanExerciseCreate(**valid_plan_exercise(target_reps_min=5, target_reps_max=5))
    assert exercise.target_reps_max == exercise.target_reps_min


def test_valid_plan_exercise_passes():
    exercise = PlanExerciseCreate(**valid_plan_exercise())
    assert exercise.exercise_name == "Squat"


def test_valid_exercise_log_passes():
    log = ExerciseLogCreate(**valid_exercise_log())
    assert log.sets_count == len(log.reps_per_set)


def test_invalid_uuid_in_source_plan_id_rejected():
    with pytest.raises(ValidationError):
        WorkoutLogCreate(**valid_workout_log(source_plan_id="not-a-uuid"))
