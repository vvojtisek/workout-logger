"""Equipment vocabulary, and whether a place can host an exercise.

An exercise lists its equipment as alternatives (`equipment_any_of`): it can
be done with any one option, and an option needs every tag in it. Bodyweight
needs nothing, so it is always available.
"""

import re
from collections.abc import Iterable

EQUIPMENT_TAGS: tuple[str, ...] = (
    "bodyweight",
    "dumbbell",
    "kettlebell",
    "barbell",
    "trap_bar",
    "rack",
    "bench",
    "pullup_bar",
    "cable",
    "machine",
    "band",
    "trx",
    "dip_bars",
    "ab_wheel",
    "box",
    "medicine_ball",
    "jump_rope",
    "bike",
    "rower",
    "treadmill",
)

# Words in the free-text equipment field, longest first so "cable machine"
# wins over "machine". None means "needs nothing" (a wall, a couch, a partner).
_WORDS: tuple[tuple[str, str | None], ...] = (
    ("back extension bench", "bench"),
    ("suspension trainer", "trx"),
    ("leg extension machine", "machine"),
    ("leg press machine", "machine"),
    ("leg curl machine", "machine"),
    ("rowing machine", "rower"),
    ("cable machine", "cable"),
    ("resistance band", "band"),
    ("exercise bike", "bike"),
    ("incline bench", "bench"),
    ("medicine ball", "medicine_ball"),
    ("pull-up bar", "pullup_bar"),
    ("squat rack", "rack"),
    ("jump rope", "jump_rope"),
    ("kettlebells", "kettlebell"),
    ("calf machine", "machine"),
    ("dip bars", "dip_bars"),
    ("ab wheel", "ab_wheel"),
    ("landmine", "barbell"),
    ("ez bar", "barbell"),
    ("bodyweight", "bodyweight"),
    ("dumbbells", "dumbbell"),
    ("kettlebell", "kettlebell"),
    ("treadmill", "treadmill"),
    ("plyo box", "box"),
    ("trap bar", "trap_bar"),
    ("dumbbell", "dumbbell"),
    ("barbell", "barbell"),
    ("machine", "machine"),
    ("partner", None),
    ("anchor", None),
    ("bench", "bench"),
    ("cable", "cable"),
    ("couch", None),
    ("band", "band"),
    ("rack", "rack"),
    ("rings", "trx"),
    ("plate", "barbell"),
    ("step", "box"),
    ("bar", "pullup_bar"),
    ("wall", None),
    ("trx", "trx"),
    ("box", "box"),
)


def _tag_for(item: str, strict: bool) -> tuple[bool, str | None]:
    for word, tag in _WORDS:
        if item == word:
            return True, tag
    if strict:
        raise ValueError(f"Unknown equipment {item!r}")
    return False, None


def parse_equipment_text(text: str | None, *, strict: bool = False) -> list[list[str]]:
    """Turns free text into alternatives. Commas join things that are all
    needed and "or" separates choices within one need, so "barbell or
    dumbbell, bench" becomes [["barbell", "bench"], ["bench", "dumbbell"]].
    A list made only of choices ("bar, rings or suspension trainer") is
    read as one set of choices. Unknown words are dropped, or rejected when
    `strict`."""
    if not text or not text.strip():
        return []
    groups = [group for group in re.split(r"\s*,\s*", text.strip().lower()) if group]
    if len(groups) > 1 and " or " in groups[-1] and all(" " not in g for g in groups[:-1]):
        # "bar, rings or suspension trainer": a plain list of choices.
        groups = [" or ".join([*groups[:-1], groups[-1]])]
    options: list[set[str]] = [set()]
    known_any = False
    for group in groups:
        choices: list[set[str]] = []
        for item in re.split(r"\s+or\s+", group):
            known, tag = _tag_for(item.strip(), strict)
            if known:
                choices.append({tag} if tag else set())
        if not choices:
            continue
        known_any = True
        options = [option | choice for option in options for choice in choices]
    if not known_any:
        return []
    return normalize_any_of(options)


def normalize_any_of(options: Iterable[Iterable[str]]) -> list[list[str]]:
    """Sorted tags per option, bodyweight dropped next to real equipment, an
    empty option read as bodyweight, and repeated options removed."""
    result: list[list[str]] = []
    for option in options:
        tags = set(option)
        if len(tags) > 1:
            tags.discard("bodyweight")
        normalized = sorted(tags) or ["bodyweight"]
        if normalized not in result:
            result.append(normalized)
    return result


def is_available(equipment_any_of: list[list[str]], location_tags: Iterable[str]) -> bool:
    """True when the exercise needs nothing, or one option's tags are all at hand."""
    if not equipment_any_of:
        return True
    have = set(location_tags) | {"bodyweight"}
    return any(set(option) <= have for option in equipment_any_of)
