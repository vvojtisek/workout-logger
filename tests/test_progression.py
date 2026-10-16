"""Double progression: the rules that pick the next session's load and reps."""

from app.services.progression import (
    LOWER_BARBELL_INCREMENT_KG,
    OTHER_INCREMENT_KG,
    SessionResult,
    load_increment,
    suggest,
)


def result(weight, reps, rir=None):
    return SessionResult(weight_kg=weight, reps=list(reps), rir=list(rir) if rir else None)


def test_no_history_uses_the_plan():
    suggestion = suggest([], rep_min=5, rep_max=8, plan_weight_kg=60, increment_kg=2.5)
    assert (suggestion.weight_kg, suggestion.reps, suggestion.source) == (60, 5, "plan")
    assert suggestion.note is None


def test_all_sets_at_the_top_with_reps_in_reserve_add_load():
    suggestion = suggest(
        [result(80, [8, 8, 8], [2, 1, 1])],
        rep_min=5,
        rep_max=8,
        plan_weight_kg=60,
        increment_kg=2.5,
    )
    assert (suggestion.weight_kg, suggestion.reps, suggestion.source) == (82.5, 5, "history")
    assert suggestion.note == "+2.5 kg: every set reached 8 reps"


def test_a_grinder_at_the_top_holds_the_load():
    # RIR 0 on the last set: the top was reached, but with nothing left.
    suggestion = suggest(
        [result(80, [8, 8, 8], [2, 1, 0])],
        rep_min=5,
        rep_max=8,
        plan_weight_kg=None,
        increment_kg=2.5,
    )
    assert (suggestion.weight_kg, suggestion.reps) == (80, 8)
    assert suggestion.note == "Same load: the last sets had no reps in reserve"


def test_missing_rir_counts_as_enough_in_reserve():
    suggestion = suggest(
        [result(20, [12, 12])], rep_min=8, rep_max=12, plan_weight_kg=None, increment_kg=1
    )
    assert suggestion.weight_kg == 21


def test_otherwise_same_load_and_one_more_rep():
    suggestion = suggest(
        [result(80, [7, 6, 6], [2, 1, 1])],
        rep_min=5,
        rep_max=8,
        plan_weight_kg=None,
        increment_kg=2.5,
    )
    assert (suggestion.weight_kg, suggestion.reps) == (80, 7)
    assert suggestion.note == "Same load, aim for 7 reps"


def test_one_rep_more_never_passes_the_top_or_drops_under_the_bottom():
    top = suggest(
        [result(80, [8, 8, 7])], rep_min=5, rep_max=8, plan_weight_kg=None, increment_kg=2.5
    )
    assert top.reps == 8
    low = suggest([result(80, [3, 3])], rep_min=5, rep_max=8, plan_weight_kg=None, increment_kg=2.5)
    assert low.reps == 5


def test_two_sessions_in_a_row_below_the_range_drop_ten_percent():
    history = [result(80, [5, 4, 4]), result(80, [4, 4, 3])]
    suggestion = suggest(history, rep_min=5, rep_max=8, plan_weight_kg=None, increment_kg=2.5)
    # 72 kg, rounded to the nearest 2.5 kg step.
    assert (suggestion.weight_kg, suggestion.reps) == (72.5, 5)
    assert suggestion.note == "-10%: two sessions in a row below 5 reps"


def test_one_miss_alone_does_not_drop():
    history = [result(80, [5, 4, 4]), result(77.5, [8, 8, 8])]
    suggestion = suggest(history, rep_min=5, rep_max=8, plan_weight_kg=None, increment_kg=2.5)
    assert suggestion.weight_kg == 80


def test_misses_at_different_loads_do_not_drop():
    history = [result(80, [4, 4]), result(82.5, [4, 4])]
    suggestion = suggest(history, rep_min=5, rep_max=8, plan_weight_kg=None, increment_kg=2.5)
    assert suggestion.weight_kg == 80


def test_drop_rounds_to_the_one_kilo_step_for_other_lifts():
    history = [result(25, [6, 5]), result(25, [6, 6])]
    suggestion = suggest(history, rep_min=8, rep_max=12, plan_weight_kg=None, increment_kg=1)
    assert suggestion.weight_kg == 22


def test_bodyweight_exercises_progress_reps_only():
    suggestion = suggest(
        [result(None, [15, 15, 15])], rep_min=10, rep_max=15, plan_weight_kg=None, increment_kg=1
    )
    assert (suggestion.weight_kg, suggestion.reps) == (None, 15)
    assert suggestion.note == "Top of the range: add a harder variation or load"


def test_increment_is_two_and_a_half_kilos_only_for_lower_body_barbell_lifts():
    assert load_increment(leg=True, barbell=True) == LOWER_BARBELL_INCREMENT_KG == 2.5
    assert load_increment(leg=True, barbell=False) == OTHER_INCREMENT_KG == 1
    assert load_increment(leg=False, barbell=True) == 1
