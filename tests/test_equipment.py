import json
from pathlib import Path

import pytest

from app.services.equipment import EQUIPMENT_TAGS, is_available, parse_equipment_text

SEED = Path(__file__).resolve().parents[1] / "alembic" / "seed" / "exercise_catalogue_v1.json"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("barbell", [["barbell"]]),
        ("dumbbells", [["dumbbell"]]),
        ("barbell, squat rack", [["barbell", "rack"]]),
        ("dumbbells, incline bench", [["bench", "dumbbell"]]),
        ("dumbbell or kettlebell", [["dumbbell"], ["kettlebell"]]),
        ("dumbbells or bodyweight", [["dumbbell"], ["bodyweight"]]),
        ("cable machine or band", [["cable"], ["band"]]),
        ("pull-up bar, resistance band", [["band", "pullup_bar"]]),
        ("leg press machine", [["machine"]]),
        ("wall or couch", [["bodyweight"]]),
        ("medicine ball, wall", [["medicine_ball"]]),
        ("", []),
        (None, []),
    ],
)
def test_parse_equipment_text(text, expected):
    assert parse_equipment_text(text) == expected


def test_every_seeded_exercise_maps_to_known_tags():
    for item in json.loads(SEED.read_text()):
        text = item.get("equipment")
        parsed = parse_equipment_text(text, strict=True)
        assert all(tag in EQUIPMENT_TAGS for option in parsed for tag in option), text
        if text:
            assert parsed, text


def test_unknown_words_are_rejected_only_in_strict_mode():
    assert parse_equipment_text("hoverboard") == []
    with pytest.raises(ValueError, match="hoverboard"):
        parse_equipment_text("hoverboard", strict=True)


def test_availability_needs_one_full_option_and_bodyweight_is_always_there():
    goblet = [["dumbbell"], ["kettlebell"]]
    bench = [["barbell", "bench", "rack"], ["bench", "dumbbell"]]
    assert is_available(goblet, {"kettlebell"})
    assert not is_available(goblet, {"barbell"})
    assert is_available(bench, {"dumbbell", "bench"})
    assert not is_available(bench, {"barbell", "bench"})
    assert is_available([["bodyweight"]], set())
    assert is_available([], set())


def test_schema_tag_list_matches_the_vocabulary():
    from typing import get_args

    from app.schemas.exercises import EquipmentTag

    assert set(get_args(EquipmentTag)) == set(EQUIPMENT_TAGS)
