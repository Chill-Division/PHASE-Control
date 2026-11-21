"""Nutrient batches: a room's reservoir, its dosers, and a feed recipe for each growth stage.

Pure, no Home Assistant, so the rules are testable on their own (feed_api.py stores and serves them).

A batch refills the room's reservoir with fresh water for a set time, and half-way through starts the
pump through the recirculation line. A pause later, while the fresh water still runs, it doses each
doser the stage's recipe uses, in that recipe's order, one after the other a pause apart, and it
recirculates until the fresh water stops, and at least a little after the last dose.
The controller app runs it; this module says what it runs.

The reservoir's level: a distance sensor above the water reads further as it empties. Its distances
when full and when empty make that a percentage, as the controller works it out, and the reservoir
keeps at least the minimum: a refill comes before a shot that would take it lower. While nothing refills
it by itself (automatic refills off, or no refill switches mapped), the controller reminds a person to
refill it by hand from the reminder level, above the minimum (CS-706).

The leak check: once the level has settled after a shot, the controller compares what the shot took
from the reservoir with what this room's shots usually take for their litres (learned from its own
shots). A shot that takes the leak factor times that, and the leak litres more, is leaky (CS-708); at
the second in a row watering is held (CS-709), unless the hold is off, until the room's watering is
switched off. Rescue shots run all the same. A factor of 0 switches it off.

The amounts: a feed recipe gives each nutrient a number of parts, and the stage a strength in mL per
litre per part. The fill's litres scale them (what is left in the reservoir is already mixed): a doser
gives parts x strength x fill litres, to the whole mL (a doser gives no finer), and runs for that at
its flow (600 mL/min unless calibrated otherwise). Athena Flower at 3 : 5 : 1 : 0.5 and 1.667 mL/L per
part in 145 L is 725 mL Core, 1208 mL Bloom, 242 mL Balance and 121 mL Cleanse.

Each recipe has its own dosing order: a stage can use a doser the others leave out (Fade in place of
Core). A recipe saved before it had one takes the room's order, which this module kept until then.

Each recipe may also give its feed EC: what it mixes to, in mS/cm, as measured once mixed. The
controller takes the recipe in use's as the feed's EC when it judges whether a flush or a diluting
shot would bring the substrate's EC down; a recipe without one (and a room without a reservoir)
leaves it counting the feed as 3.0 mS/cm.

The stage in use: a feed schedule gives each week of the grow a recipe (Week 1 Vege, Weeks 2-6 Bloom,
Weeks 7-8 Fade), from the day its first week starts; after its last week, that week's recipe carries on.
A stage picked by hand while it runs holds until the schedule's next week starts. Without a schedule,
the stage is the one picked by hand.
"""

from __future__ import annotations

import math
import re
import uuid
from datetime import date, timedelta

from .room import DOSER_KEYS, MAX_DOSERS, RESERVOIR_KEYS  # noqa: F401 (the one list)

MAX_RECIPES = 12
MAX_WEEKS = 52  # a feed schedule's weeks
NAME_LEN = 40
DEFAULT_FLOW = 600.0  # mL/min, a doser's flow until it is calibrated
# field -> (lowest, highest, whole number)
SETTINGS = {
    "fill_s": (10, 7200, True),  # how long the fresh water runs
    "batch_l": (
        1,
        5000,
        False,
    ),  # the litres the fill adds: what the doses are worked out for
    "full_mm": (
        0,
        10000,
        False,
    ),  # the level sensor's distance to the water when full; 0 = not set
    "empty_mm": (
        0,
        10000,
        False,
    ),  # and when empty; 0 = not set (until 2.30, "almost empty at")
    "min_pct": (
        0,
        50,
        False,
    ),  # the least the reservoir keeps: a refill comes first; 0 = off
    "remind_pct": (
        0,
        90,
        False,
    ),  # without automatic refills, a reminder to refill by hand from here; 0 = off
    "pause_s": (0, 600, True),  # between one doser and the next
    "mix_s": (0, 7200, True),  # recirculating after the last dose
    # the leak check: a shot is leaky at this many times what this room's shots usually take from the
    # reservoir (0 = off, else LEAK_FACTOR_LOWEST or more)...
    "leak_factor": (0, 20, False),
    "leak_min_l": (0, 500, False),  # ...and at least this many litres more
}
DEFAULTS = {
    "fill_s": 600,
    "batch_l": 100.0,
    "full_mm": 0.0,
    "empty_mm": 0.0,
    "min_pct": 5.0,
    "remind_pct": 20.0,
    "pause_s": 10,
    "mix_s": 10,
    "leak_factor": 3.0,
    "leak_min_l": 10.0,
}
# Under this, ordinary shots would read as leaky: a room's own shots vary that much.
LEAK_FACTOR_LOWEST = 1.5
FLOW = (1.0, 10000.0)  # mL/min
STRENGTH = (0.0, 20.0)  # mL per litre per part
PARTS = (0.0, 100.0)
FEED_EC = (0.1, 10.0)  # mS/cm, what a recipe mixes to; none = not given
# A whole recipe's mL per litre. Nutrient lines run at 5-20; a strength typed ten times too big is
# refused rather than dosed.
MAX_ML_PER_L = 60.0


def empty() -> dict:
    return {
        "revision": 0,
        **DEFAULTS,
        "leak_hold": True,  # the second leaky shot in a row holds watering (CS-709); off = it only warns
        "dosers": {},
        # The room's dosing order, from before each recipe had its own: a recipe without one takes it.
        "order": [],
        "recipes": [],
        "stage": None,  # the recipe picked by hand
        # Each week's recipe from the day the first week starts; none = no schedule.
        "schedule": {"start": None, "weeks": []},
        "held_until": None,  # a stage picked by hand while the schedule runs holds until this day
    }


def _number(value, low, high, whole, what):
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not low <= value <= high
        or (whole and int(value) != value)
    ):
        raise ValueError(f"{what} must be a number from {low:g} to {high:g}")
    return int(value) if whole else float(value)


def _name(value, what) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{what} needs a name")
    name = re.sub(r"\s+", " ", value.strip())
    if len(name) > NAME_LEN:
        raise ValueError(f"{what} is longer than {NAME_LEN} characters")
    return name


def _doser(value) -> int:
    number = int(value) if isinstance(value, str) and value.isdigit() else value
    if (
        isinstance(number, bool)
        or not isinstance(number, int)
        or not 1 <= number <= MAX_DOSERS
    ):
        raise ValueError(f"A doser is numbered 1 to {MAX_DOSERS}")
    return number


def clean(payload, old: dict | None = None) -> dict:
    """An edited document, checked, with the revision it replaces. Anything malformed is refused
    with a reason a person can act on."""
    if not isinstance(payload, dict):
        raise ValueError("Feed settings must be an object")
    old = old or empty()
    doc = empty()
    doc["revision"] = old.get("revision", 0)
    for key, (low, high, whole) in SETTINGS.items():
        value = payload.get(key, old.get(key, DEFAULTS[key]))
        doc[key] = _number(value, low, high, whole, key.replace("_", " "))
    if 0 < doc["leak_factor"] < LEAK_FACTOR_LOWEST:
        raise ValueError(
            f"The leak factor must be 0 (off) or at least {LEAK_FACTOR_LOWEST:g}: under that, ordinary "
            "shots would read as leaks"
        )
    hold = payload.get("leak_hold", old.get("leak_hold", True))
    if not isinstance(hold, bool):
        raise ValueError("Hold watering on a leak must be true or false")
    doc["leak_hold"] = hold
    if 0 < doc["empty_mm"] <= doc["full_mm"]:
        raise ValueError(
            "The distance when full must be less than the distance when empty: the level sensor "
            "is above the water, so it reads further as the reservoir empties"
        )
    dosers = payload.get("dosers", old.get("dosers", {}))
    if not isinstance(dosers, dict):
        raise ValueError("Dosers must be an object")
    for key, value in dosers.items():
        number = _doser(key)
        flow = (
            value.get("flow_ml_min", DEFAULT_FLOW) if isinstance(value, dict) else value
        )
        doc["dosers"][str(number)] = {
            "flow_ml_min": _number(flow, *FLOW, False, f"Doser {number}'s flow")
        }
    doc["order"] = _order(
        payload.get("order", old.get("order", [])), "the dosing order"
    )
    recipes = payload.get("recipes", old.get("recipes", []))
    if not isinstance(recipes, list) or len(recipes) > MAX_RECIPES:
        raise ValueError(f"Up to {MAX_RECIPES} feed recipes")
    names, ids = set(), set()
    for raw in recipes:
        if not isinstance(raw, dict):
            raise ValueError("A feed recipe must be an object")
        name = _name(raw.get("name"), "A feed recipe")
        if name.casefold() in names:
            raise ValueError(f"Two feed recipes are called {name}")
        names.add(name.casefold())
        recipe_id = raw.get("id")
        if not isinstance(recipe_id, str) or not re.fullmatch(
            r"[A-Za-z0-9_-]{1,40}", recipe_id
        ):
            recipe_id = uuid.uuid4().hex[:12]
        if recipe_id in ids:
            raise ValueError(f"Two feed recipes share the id {recipe_id}")
        ids.add(recipe_id)
        strength = _number(
            raw.get("strength", 0), *STRENGTH, False, f"{name}'s strength"
        )
        doses = raw.get("doses", {})
        if not isinstance(doses, dict):
            raise ValueError(f"{name}'s doses must be an object")
        clean_doses = {}
        for key, dose in doses.items():
            number = _doser(key)
            if not isinstance(dose, dict):
                raise ValueError(
                    f"{name}: doser {number} needs a nutrient and its parts"
                )
            label = dose.get("label") or ""
            if not isinstance(label, str):
                raise ValueError(f"{name}: doser {number}'s nutrient must be text")
            label = (
                _name(label, f"{name}: doser {number}'s nutrient")
                if label.strip()
                else ""
            )
            parts = _number(
                dose.get("parts", 0), *PARTS, False, f"{name}: doser {number}'s parts"
            )
            if parts and not label:
                raise ValueError(f"{name}: doser {number} has parts but no nutrient")
            clean_doses[str(number)] = {"label": label, "parts": parts}
        per_litre = strength * sum(dose["parts"] for dose in clean_doses.values())
        if per_litre > MAX_ML_PER_L:
            raise ValueError(
                f"{name} comes to {per_litre:.1f} mL per litre; more than {MAX_ML_PER_L:g} "
                "is refused as a likely typo in its strength or parts"
            )
        order = raw.get("order")
        # What it mixes to. None (or left empty, 0) = not given; a recipe saved before has none.
        feed_ec = raw.get("ec")
        doc["recipes"].append(
            {
                "id": recipe_id,
                "name": name,
                "strength": strength,
                "ec": (
                    None
                    if feed_ec in (None, "", 0)
                    else _number(feed_ec, *FEED_EC, False, f"{name}'s feed EC")
                ),
                "doses": clean_doses,
                # One saved before recipes had their own order takes the room's.
                "order": (
                    list(doc["order"])
                    if order is None
                    else _order(order, f"{name}'s dosing order")
                ),
            }
        )
    stage = payload.get("stage", old.get("stage"))
    doc["stage"] = stage if stage in ids else None
    schedule = payload.get("schedule", old.get("schedule")) or {}
    if not isinstance(schedule, dict):
        raise ValueError("The feed schedule must be an object")
    weeks = schedule.get("weeks") or []
    if not isinstance(weeks, list) or len(weeks) > MAX_WEEKS:
        raise ValueError(f"A feed schedule has at most {MAX_WEEKS} weeks")
    for number, recipe_id in enumerate(weeks, start=1):
        if recipe_id not in ids:
            raise ValueError(
                f"Week {number} of the feed schedule uses a feed recipe that is not there"
            )
    doc["schedule"] = {
        "start": _day(schedule.get("start"), "The feed schedule's first week"),
        "weeks": list(weeks),
    }
    doc["held_until"] = _day(
        payload.get("held_until", old.get("held_until")), "A stage held by hand"
    )
    return doc


def _day(value, what) -> str | None:
    """A day, YYYY-MM-DD, or None."""
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value)).isoformat()
    except ValueError:
        raise ValueError(f"{what} must be a date") from None


def schedule_week(doc: dict, today: date) -> tuple[int, str] | None:
    """The feed schedule's week today and the recipe it doses then, by id; None without a schedule
    (no first day, or no weeks) or before it starts. Week 1 is the 7 days from its first day; after
    its last week, the last week's recipe carries on."""
    schedule = doc.get("schedule") or {}
    start, weeks = schedule.get("start"), schedule.get("weeks") or []
    if not start or not weeks:
        return None
    days = (today - date.fromisoformat(start)).days
    if days < 0:
        return None
    week = days // 7 + 1
    return week, weeks[min(week, len(weeks)) - 1]


def week_starts(doc: dict, week: int) -> date:
    """The day the feed schedule's `week` starts."""
    return date.fromisoformat(doc["schedule"]["start"]) + timedelta(days=7 * (week - 1))


def held(doc: dict, today: date) -> str | None:
    """Until when a stage picked by hand holds over the schedule (YYYY-MM-DD), or None."""
    until = doc.get("held_until")
    if until and schedule_week(doc, today) and today < date.fromisoformat(until):
        return until
    return None


def in_use(doc: dict, today: date) -> str | None:
    """The recipe in use today, by id: the schedule's this week, unless a stage picked by hand still
    holds; without a schedule running, the stage picked by hand."""
    now = schedule_week(doc, today)
    if now is None or held(doc, today):
        return doc.get("stage")
    return now[1]


def pick(doc: dict, recipe_id, today: date) -> dict:
    """A stage picked by hand, in `doc`: with the schedule running it holds until the schedule's next
    week starts (this week's own recipe ends a hold); without one it is the stage."""
    doc["stage"] = recipe_id
    now = schedule_week(doc, today)
    doc["held_until"] = (
        week_starts(doc, now[0] + 1).isoformat()
        if now is not None and recipe_id != now[1]
        else None
    )
    return doc


def _order(value, what) -> list[int]:
    """A dosing order, `what` as a sentence names it ("the dosing order", "Fade's dosing order")."""
    if not isinstance(value, list):
        raise ValueError(f"{what[:1].upper()}{what[1:]} must be a list of dosers")
    numbers = [_doser(item) for item in value]
    if len(set(numbers)) != len(numbers):
        raise ValueError(f"A doser appears twice in {what}")
    return numbers


def recipe_order(stage: dict, mapped: dict[int, str]) -> list[int]:
    """The dosers the room has, in the order this recipe doses them: those in its order first, then
    any other mapped doser by number."""
    order = [number for number in stage.get("order", []) if number in mapped]
    return order + sorted(number for number in mapped if number not in order)


def whole_ml(value: float) -> int:
    """A dose to the whole mL, halves up: 719.925 mL is 720."""
    return int(math.floor(value + 0.5))


def flow(doc: dict, number: int) -> float:
    return float(
        (doc.get("dosers", {}).get(str(number)) or {}).get("flow_ml_min", DEFAULT_FLOW)
    )


def recipe(doc: dict, recipe_id=None) -> dict | None:
    wanted = doc.get("stage") if recipe_id is None else recipe_id
    return next((item for item in doc.get("recipes", []) if item["id"] == wanted), None)


def plan(doc: dict, mapped: dict[int, str], today: date | None = None) -> dict:
    """What the controller runs for this room's next batch: the batch settings and, in the order of
    the stage in use, each doser's nutrient, mL (whole) and seconds for that stage. `today` (the day
    in Home Assistant's time zone) picks the stage in use; `week`, `weeks`, `schedule_start`,
    `held_until` and `source` ("schedule", "held" or "hand") say how. `problem` says why no batch
    can run, or is None. `feed_ec` is the stage's feed EC, or None. `mapped` is the room's doser
    switches by number (Rooms & hardware).
    """
    today = today or date.today()
    stage = recipe(doc, in_use(doc, today))
    now, holding = schedule_week(doc, today), held(doc, today)
    doses, problem = [], None
    if not mapped:
        problem = "No doser is mapped in Settings → Rooms & hardware."
    elif stage is None:
        problem = "No feed stage is chosen."
    else:
        wanted = {
            int(key): dose for key, dose in stage["doses"].items() if dose["parts"] > 0
        }
        missing = sorted(number for number in wanted if number not in mapped)
        if missing:
            problem = f"{stage['name']} uses doser {missing[0]}, which has no switch in Settings → Rooms & hardware."
        elif not wanted:
            problem = f"{stage['name']} doses nothing: give its nutrients some parts."
        for number in recipe_order(stage, mapped):
            if number not in wanted:
                continue
            ml = whole_ml(wanted[number]["parts"] * stage["strength"] * doc["batch_l"])
            doses.append(
                {
                    "doser": number,
                    "label": wanted[number]["label"],
                    "ml": ml,
                    "seconds": round(ml / flow(doc, number) * 60.0, 1),
                }
            )
        if not problem and not any(dose["ml"] > 0 for dose in doses):
            problem = f"{stage['name']}'s strength is 0: nothing would be dosed."
    schedule = doc.get("schedule") or {}
    return {
        "stage": stage["name"] if stage else None,
        "stage_id": stage["id"] if stage else None,
        "feed_ec": stage.get("ec") if stage else None,
        **{key: doc[key] for key in SETTINGS},
        "leak_hold": doc.get("leak_hold", True),
        "doses": doses,
        "problem": problem,
        "week": now[0] if now else None,
        "weeks": len(schedule.get("weeks") or []),
        "schedule_start": schedule.get("start"),
        "held_until": holding,
        "source": "held" if holding else "schedule" if now else "hand",
    }
