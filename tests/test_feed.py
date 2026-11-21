"""Nutrient batches: the feed settings and recipes a room keeps, checked, and the plan the controller
runs from them (custom_components/crop_steering/feed.py, feed_api.py)."""

import asyncio
import copy
from datetime import date, timedelta
import sys
import types

import pytest

from . import ha_stubs

ha_stubs.install()

from custom_components.crop_steering import feed, feed_api  # noqa: E402
from custom_components.crop_steering.const import DOMAIN  # noqa: E402

DOSERS = {
    "doser_1_switch": "switch.doser_1",
    "doser_2_switch": "switch.doser_2",
    "doser_3_switch": "switch.doser_3",
    "doser_4_switch": "switch.doser_4",
}
MAPPED = {
    1: "switch.doser_1",
    2: "switch.doser_2",
    3: "switch.doser_3",
    4: "switch.doser_4",
}
# Athena Flower, as the owner runs it: 3 Core : 5 Bloom : 1 Balance : 0.5 Cleanse, one part being
# 1.667 mL per litre, on doser 4 (Core), 3 (Bloom), 2 (Balance) and 1 (Cleanse).
FLOWER = {
    "id": "flower",
    "name": "Flower",
    "strength": 5 / 3,
    "doses": {
        "4": {"label": "Core", "parts": 3},
        "3": {"label": "Bloom", "parts": 5},
        "2": {"label": "Balance", "parts": 1},
        "1": {"label": "Cleanse", "parts": 0.5},
    },
}


def settings(**changes):
    doc = {
        "batch_l": 145,
        "fill_s": 621,
        "order": [4, 3, 2, 1],
        "recipes": [copy.deepcopy(FLOWER)],
        "stage": "flower",
    }
    doc.update(changes)
    return feed.clean(doc)


def test_a_ratio_and_a_strength_become_each_dosers_ml_and_seconds():
    plan = feed.plan(settings(), MAPPED)
    assert plan["stage"] == "Flower" and plan["problem"] is None
    assert [(d["doser"], d["label"], d["ml"], d["seconds"]) for d in plan["doses"]] == [
        (4, "Core", 725, 72.5),  # 3 x 1.667 mL/L x 145 L, at 600 mL/min
        (3, "Bloom", 1208, 120.8),  # to the whole mL: a doser gives no finer
        (2, "Balance", 242, 24.2),
        (1, "Cleanse", 121, 12.1),
    ]
    assert plan["fill_s"] == 621 and plan["batch_l"] == 145.0


def test_doses_are_whole_ml_so_parts_of_one_amount_add_up():
    """The owner's Bloom: 1.655 mL per litre per part in 145 L is 239.975 mL a part. Each dose to a
    tenth of a mL read 719.9 and 1,199.9 beside 240 and 120; to the whole mL, halves up, 720 and 1,200.
    """
    flower = {**copy.deepcopy(FLOWER), "strength": 1.655}
    plan = feed.plan(settings(recipes=[flower]), MAPPED)
    assert {d["label"]: d["ml"] for d in plan["doses"]} == {
        "Core": 720,
        "Bloom": 1200,
        "Balance": 240,
        "Cleanse": 120,
    }
    assert feed.whole_ml(719.5) == 720 and feed.whole_ml(0.4) == 0


def test_the_batch_size_scales_every_dose_and_a_calibrated_flow_its_time():
    plan = feed.plan(settings(batch_l=72.5, dosers={"3": {"flow_ml_min": 450}}), MAPPED)
    bloom = next(d for d in plan["doses"] if d["doser"] == 3)
    assert bloom["ml"] == 604 and bloom["seconds"] == pytest.approx(80.5, abs=0.05)


def test_each_recipe_doses_in_its_own_order_then_any_other_by_number():
    """Fade weeks use the Fade doser in place of Core's: a stage has its own dosers, in its order."""
    fade = {
        "id": "fade",
        "name": "Fade",
        "strength": 1.655,
        "doses": {
            "5": {"label": "Fade", "parts": 3},
            "2": {"label": "Balance", "parts": 1},
            "1": {"label": "Cleanse", "parts": 0.5},
        },
        "order": [1, 5],
    }
    doc = settings(recipes=[copy.deepcopy(FLOWER), fade], stage="fade")
    mapped = {**MAPPED, 5: "switch.doser_5"}
    assert [d["label"] for d in feed.plan(doc, mapped)["doses"]] == [
        "Cleanse",
        "Fade",
        "Balance",
    ]
    doc["stage"] = "flower"  # Flower keeps the room's order it was saved with
    assert [d["doser"] for d in feed.plan(doc, mapped)["doses"]] == [4, 3, 2, 1]


def test_a_recipe_saved_before_recipes_had_their_own_order_takes_the_rooms():
    doc = settings(order=[2])
    assert doc["recipes"][0]["order"] == [2]
    assert [d["doser"] for d in feed.plan(doc, MAPPED)["doses"]] == [2, 1, 3, 4]


def test_a_doser_without_parts_is_skipped_and_one_without_a_switch_stops_the_batch():
    doses = copy.deepcopy(FLOWER["doses"])
    doses["2"]["parts"] = 0
    plan = feed.plan(settings(recipes=[{**FLOWER, "doses": doses}]), MAPPED)
    assert [d["doser"] for d in plan["doses"]] == [4, 3, 1] and plan["problem"] is None
    plan = feed.plan(settings(), {n: e for n, e in MAPPED.items() if n != 3})
    assert (
        plan["problem"]
        == "Flower uses doser 3, which has no switch in Settings → Rooms & hardware."
    )


@pytest.mark.parametrize(
    "doc, mapped, problem",
    [
        ({}, MAPPED, "No feed stage is chosen."),
        ({"stage": "flower"}, {}, "No doser is mapped in Settings → Rooms & hardware."),
        (
            {"stage": "flower", "strength": 0},
            MAPPED,
            "Flower's strength is 0: nothing would be dosed.",
        ),
    ],
)
def test_it_says_why_no_batch_can_run(doc, mapped, problem):
    recipe = {**FLOWER, "strength": doc.get("strength", FLOWER["strength"])}
    chosen = settings(recipes=[recipe], stage=doc.get("stage"))
    assert feed.plan(chosen, mapped)["problem"] == problem


def test_a_recipe_that_doses_nothing_says_so():
    empty = {**FLOWER, "doses": {"4": {"label": "Core", "parts": 0}}}
    assert (
        feed.plan(settings(recipes=[empty]), MAPPED)["problem"]
        == "Flower doses nothing: give its nutrients some parts."
    )


@pytest.mark.parametrize(
    "changes, reason",
    [
        ({"batch_l": 0}, "batch l must be a number from 1 to 5000"),
        ({"fill_s": 12.5}, "fill s must be a number from 10 to 7200"),
        ({"mix_s": True}, "mix s must be a number"),
        ({"min_pct": 60}, "min pct must be a number from 0 to 50"),
        ({"remind_pct": 95}, "remind pct must be a number from 0 to 90"),
        ({"leak_factor": 25}, "leak factor must be a number from 0 to 20"),
        (
            {"leak_factor": 1.2},
            "or at least 1.5: under that, ordinary shots would read as leaks",
        ),
        ({"leak_min_l": 600}, "leak min l must be a number from 0 to 500"),
        ({"leak_hold": "yes"}, "Hold watering on a leak must be true or false"),
        (
            {"full_mm": 850, "empty_mm": 125},
            "The distance when full must be less than the distance when empty",
        ),
        ({"order": [1, 1]}, "A doser appears twice in the dosing order"),
        ({"order": [7]}, "A doser is numbered 1 to 6"),
        (
            {"recipes": [{**FLOWER, "order": [4, 4]}]},
            "A doser appears twice in Flower's dosing order",
        ),
        (
            {"recipes": [{**FLOWER, "order": "4321"}]},
            "Flower's dosing order must be a list",
        ),
        ({"dosers": {"2": {"flow_ml_min": 0}}}, "Doser 2's flow must be a number"),
        (
            {"recipes": [FLOWER, {**FLOWER, "id": "b"}]},
            "Two feed recipes are called Flower",
        ),
        ({"recipes": [{**FLOWER, "strength": 7}]}, "comes to 66.5 mL per litre"),
        (
            {"recipes": [{**FLOWER, "doses": {"4": {"label": "", "parts": 3}}}]},
            "Flower: doser 4 has parts but no nutrient",
        ),
        (
            {"recipes": [{**FLOWER, "doses": {"4": {"label": 5, "parts": 3}}}]},
            "nutrient must be text",
        ),
        (
            {"recipes": [{**FLOWER, "name": "x" * 41}]},
            "A feed recipe is longer than 40 characters",
        ),
        (
            {"recipes": [{**FLOWER, "id": str(n), "name": str(n)} for n in range(13)]},
            "Up to 12 feed recipes",
        ),
        ({"recipes": [{**FLOWER, "ec": 12}]}, "Flower's feed EC must be a number"),
        ({"recipes": [{**FLOWER, "ec": 0.05}]}, "from 0.1 to 10"),
        ({"recipes": [{**FLOWER, "ec": "2.8"}]}, "Flower's feed EC must be a number"),
    ],
)
def test_a_setting_or_recipe_that_does_not_make_sense_is_refused(changes, reason):
    with pytest.raises(ValueError, match=reason):
        settings(**changes)


def test_a_stage_whose_recipe_is_gone_is_no_stage():
    assert settings(stage="nothing")["stage"] is None
    kept = settings(recipes=[{**FLOWER, "id": "?? not an id"}], stage="flower")
    assert kept["recipes"][0]["id"] != "?? not an id" and kept["stage"] is None


def test_a_fresh_room_has_the_defaults_and_nothing_to_run():
    doc = feed.empty()
    assert (doc["fill_s"], doc["pause_s"], doc["mix_s"], doc["min_pct"]) == (
        600,
        10,
        10,
        5.0,
    )
    assert (doc["full_mm"], doc["empty_mm"]) == (
        0.0,
        0.0,
    )  # no level until both are set
    assert feed.plan(doc, MAPPED)["problem"] == "No feed stage is chosen."
    assert feed.flow(doc, 1) == 600.0
    assert (
        doc["remind_pct"] == 20.0
    )  # a reminder to refill by hand, above the 5% minimum


# ------------------------------------------------------------------ the store
class MemoryStore:
    def __init__(self, value=None):
        self.value, self.saves = value, 0

    async def async_load(self):
        return copy.deepcopy(self.value)

    async def async_save(self, value):
        self.value, self.saves = copy.deepcopy(value), self.saves + 1


@pytest.fixture(autouse=True)
def dispatcher(monkeypatch):
    module = types.ModuleType("homeassistant.helpers.dispatcher")
    module.sent = []
    module.async_dispatcher_send = lambda hass, signal, *a: module.sent.append(signal)
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.dispatcher", module)
    return module


def rig(value=None, hardware=DOSERS):
    hass = ha_stubs.FakeHass(data={DOMAIN: {"entry": {"hardware": dict(hardware)}}})
    store = feed_api.FeedStore(
        hass, ha_stubs.FakeEntry(entry_id="entry"), MemoryStore(value)
    )
    asyncio.run(store.async_init())
    return store


def save(store, **document):
    return asyncio.run(
        store.save({"expected_revision": store.data["revision"], "document": document})
    )


def test_saving_takes_the_next_revision_and_tells_the_entities(dispatcher):
    store = rig()
    response = save(
        store, recipes=[FLOWER], stage="flower", batch_l=145, order=[4, 3, 2, 1]
    )
    assert response["revision"] == 1 and store._store.saves == 1
    assert response["mapped"] == {"1": "switch.doser_1", "2": "switch.doser_2",
                                  "3": "switch.doser_3", "4": "switch.doser_4"}  # fmt: skip
    assert response["plan"]["doses"][0]["ml"] == 725
    assert dispatcher.sent == [f"{feed_api.SIGNAL}_entry"]


def test_a_save_on_an_old_revision_is_refused():
    store = rig()
    save(store, batch_l=100)
    with pytest.raises(ValueError, match="changed elsewhere"):
        asyncio.run(store.save({"expected_revision": 0, "document": {"batch_l": 90}}))


def test_the_stage_is_chosen_by_its_recipes_name():
    store = rig()
    save(
        store, recipes=[FLOWER, {**FLOWER, "id": "veg", "name": "Vege"}], stage="flower"
    )
    asyncio.run(store.set_stage("Vege"))
    assert store.data["stage"] == "veg" and store.data["revision"] == 2
    with pytest.raises(ValueError, match="No feed recipe is called Fade"):
        asyncio.run(store.set_stage("Fade"))


def test_a_stored_document_that_cannot_be_read_is_kept_and_named():
    store = rig({"revision": "one"})
    assert store.error and "have not been overwritten" in store.error
    with pytest.raises(ValueError, match="have not been overwritten"):
        save(store, batch_l=100)
    assert store._store.value == {"revision": "one"}


def test_the_reservoirs_distances_and_minimum_reach_the_controllers_plan():
    plan = feed.plan(
        settings(full_mm=125, empty_mm=850, min_pct=5, batch_l=145), MAPPED
    )
    assert (plan["full_mm"], plan["empty_mm"], plan["min_pct"], plan["batch_l"]) == (
        125,
        850,
        5,
        145,
    )
    assert "settle_s" not in plan  # the pump starts half-way through the fill instead
    assert (
        feed.plan(settings(empty_mm=850), MAPPED)["full_mm"] == 0.0
    )  # one alone: no level yet


def test_a_document_saved_before_the_reservoirs_level_loads_with_its_mark_as_the_empty_distance():
    """Until 2.30 a room had an "almost empty at" distance and a settle before the first dose; its
    stored document still loads: the mark is the distance when empty, the settle is gone, and the
    minimum and the distance when full start at their defaults."""
    old = {
        "revision": 3,
        "fill_s": 690,
        "batch_l": 145,
        "empty_mm": 800,
        "settle_s": 20,
        "pause_s": 10,
        "mix_s": 600,
        "dosers": {},
        "order": [],
        "recipes": [],
        "stage": None,
    }
    store = rig(old)
    assert store.error is None
    data = store.data
    assert (data["empty_mm"], data["full_mm"], data["min_pct"], data["mix_s"]) == (
        800,
        0.0,
        5.0,
        600,
    )
    assert "settle_s" not in data and data["revision"] == 3


def test_the_refill_reminder_reaches_the_controllers_plan_and_an_older_room_gets_it_at_20():
    """The level the controller reminds a person to refill by hand at (CS-706). A document stored
    before it had one loads at 20%; 0 turns it off. One at or under the minimum is kept as it is:
    the controller does not remind there, and the dashboard says so, but no other save is refused
    for it, nor is the document when it loads."""
    assert feed.plan(settings(remind_pct=30), MAPPED)["remind_pct"] == 30
    assert feed.plan(settings(remind_pct=0), MAPPED)["remind_pct"] == 0
    stored = {"revision": 4, "fill_s": 690, "batch_l": 145, "min_pct": 25}
    store = rig(stored)
    assert store.error is None
    assert (store.data["remind_pct"], store.data["min_pct"]) == (20.0, 25)
    assert feed.plan(store.data, MAPPED)["remind_pct"] == 20.0


def test_the_leak_check_reaches_the_controllers_plan_and_an_older_room_gets_its_defaults():
    """The leak check's settings: a shot is leaky at the factor times what this room's shots usually
    take from the reservoir and the litres more (CS-708), and the second in a row holds watering
    (CS-709) unless the hold is off. A document stored before them loads at 3 times, 10 L and holding;
    a factor of 0 switches it off."""
    doc = feed.empty()
    assert (doc["leak_factor"], doc["leak_min_l"], doc["leak_hold"]) == (
        3.0,
        10.0,
        True,
    )
    sent = feed.plan(settings(leak_factor=4.5, leak_min_l=25, leak_hold=False), MAPPED)
    assert (sent["leak_factor"], sent["leak_min_l"], sent["leak_hold"]) == (
        4.5,
        25,
        False,
    )
    assert feed.plan(settings(leak_factor=0), MAPPED)["leak_factor"] == 0
    store = rig({"revision": 4, "fill_s": 690, "batch_l": 145, "min_pct": 25})
    assert store.error is None
    assert (
        store.data["leak_factor"],
        store.data["leak_min_l"],
        store.data["leak_hold"],
    ) == (3.0, 10.0, True)
    sent = feed.plan(store.data, MAPPED)
    assert (sent["leak_factor"], sent["leak_min_l"], sent["leak_hold"]) == (
        3.0,
        10.0,
        True,
    )
    kept = feed.clean(
        {"leak_min_l": 15}, settings(leak_hold=False)
    )  # an edit keeps what it leaves out
    assert (kept["leak_min_l"], kept["leak_hold"]) == (15, False)


def test_the_recipe_in_uses_feed_ec_reaches_the_controllers_plan():
    """What a recipe mixes to: the controller's feed EC for its flush and dilution tests."""
    veg = {**FLOWER, "id": "veg", "name": "Veg", "ec": 1.6}
    doc = settings(recipes=[{**FLOWER, "ec": 2.8}, veg])
    assert [recipe["ec"] for recipe in doc["recipes"]] == [2.8, 1.6]
    assert feed.plan(doc, MAPPED)["feed_ec"] == 2.8
    assert feed.plan(feed.clean({**doc, "stage": "veg"}), MAPPED)["feed_ec"] == 1.6
    # No stage, no feed EC; even with no doser mapped, the recipe in use still gives its own.
    assert feed.plan(feed.clean({**doc, "stage": None}), MAPPED)["feed_ec"] is None
    assert feed.plan(doc, {})["feed_ec"] == 2.8


@pytest.mark.parametrize("given", [None, "", 0])
def test_a_recipe_without_a_feed_ec_gives_none(given):
    doc = settings(recipes=[{**FLOWER, "ec": given}])
    assert doc["recipes"][0]["ec"] is None
    assert feed.plan(doc, MAPPED)["feed_ec"] is None


def test_a_recipe_saved_before_recipes_had_a_feed_ec_loads_without_one():
    stored = {"revision": 3, "batch_l": 145, "recipes": [FLOWER], "stage": "flower"}
    assert "ec" not in FLOWER
    store = rig(stored)
    assert store.error is None and store.data["recipes"][0]["ec"] is None
    assert feed.plan(store.data, MAPPED)["feed_ec"] is None


def test_a_stored_document_loads_as_it_was_saved():
    first = rig()
    save(first, recipes=[FLOWER], stage="flower", order=[4, 3, 2, 1])
    again = rig(first._store.value)
    assert again.data == first.data and again.error is None


def test_only_the_rooms_mapped_dosers_count():
    assert feed_api.mapped_dosers(
        {"doser_2_switch": "switch.b", "doser_5_switch": ""}
    ) == {2: "switch.b"}
    assert (
        rig(hardware={}).response()["plan"]["problem"]
        == "No doser is mapped in Settings → Rooms & hardware."
    )


def test_mixing_a_batch_presses_the_rooms_button_once_the_plan_can_run():
    store = rig()
    button = "button.crop_steering_mix_batch"
    with pytest.raises(ValueError, match="is not available"):
        asyncio.run(store.mix())
    store.hass.states.set(button, "unknown")
    with pytest.raises(ValueError, match="No feed stage is chosen"):
        asyncio.run(store.mix())
    assert store.hass.services.calls == []
    save(store, recipes=[FLOWER], stage="flower", order=[4, 3, 2, 1])
    response = asyncio.run(store.mix())
    assert store.hass.services.calls == [("button", "press", {"entity_id": button})]
    assert response["plan"]["stage"] == "Flower" and "requested" in response


def test_a_test_refill_run_anyway_says_so_on_the_plan_before_its_press(dispatcher):
    """feed_mix with force: for the next FORCE_S the plan sensor carries mix_force_until (the entity
    rewritten through the dispatcher), then the button is pressed. Without force, nothing changes.
    """
    store = rig()
    store.hass.states.set("button.crop_steering_mix_batch", "unknown")
    save(store, recipes=[FLOWER], stage="flower", order=[4, 3, 2, 1])
    dispatcher.sent.clear()
    asyncio.run(store.mix())
    assert store.forced() is None and dispatcher.sent == []
    order = []
    dispatcher.async_dispatcher_send = lambda hass, signal, *a: order.append("plan")
    calls = store.hass.services.calls
    store.hass.services.async_call = lambda *a, **k: _press(order, calls, a)
    asyncio.run(store.mix(force=True))
    assert order == ["plan", "press"]  # the word is on the plan before the press
    assert store.forced() == "2026-01-01T12:02:00+00:00"  # the stub's now, plus FORCE_S
    store.force_until -= timedelta(seconds=feed_api.FORCE_S + 1)
    assert store.forced() is None  # gone once its time is up


async def _press(order, calls, args):
    order.append("press")
    calls.append(args[:3])


# ------------------------------------------------------------------ the feed schedule
VEGE = {**copy.deepcopy(FLOWER), "id": "vege", "name": "Vege"}
FADE = {**copy.deepcopy(FLOWER), "id": "fade", "name": "Fade"}
# The owner's example: Week 1 Vege, Weeks 2-6 Bloom, Weeks 7-8 Fade, from Monday 5 October.
WEEKS = ["vege"] + ["flower"] * 5 + ["fade"] * 2
START = date(2026, 10, 5)


def scheduled(**changes):
    return settings(
        **{
            "recipes": [copy.deepcopy(FLOWER), VEGE, FADE],
            "stage": "vege",
            "schedule": {"start": START.isoformat(), "weeks": WEEKS},
            **changes,
        }
    )


def test_the_schedule_gives_each_week_its_recipe_and_the_last_carries_on():
    doc = scheduled()
    on = lambda days: feed.in_use(doc, START + timedelta(days=days))  # noqa: E731
    assert feed.schedule_week(doc, START - timedelta(days=1)) is None  # not begun
    assert (on(0), on(6), on(7), on(41), on(42), on(55)) == (
        "vege",  # week 1, its first day
        "vege",  # and its last
        "flower",  # week 2
        "flower",  # week 6
        "fade",  # week 7
        "fade",  # week 8
    )
    # After the last week, its recipe carries on.
    assert feed.schedule_week(doc, START + timedelta(days=70)) == (11, "fade")
    plan = feed.plan(doc, MAPPED, START + timedelta(days=9))
    assert (plan["stage"], plan["week"], plan["weeks"], plan["source"]) == (
        "Flower",
        2,
        8,
        "schedule",
    )
    assert plan["schedule_start"] == "2026-10-05" and plan["held_until"] is None


def test_without_a_schedule_or_before_it_starts_the_stage_is_the_one_picked_by_hand():
    assert feed.in_use(settings(stage="flower"), START) == "flower"
    early = scheduled()
    # Before it starts, the stage picked by hand, as before.
    assert feed.in_use(early, START - timedelta(days=3)) == "vege"
    assert feed.plan(early, MAPPED, START - timedelta(days=3))["source"] == "hand"
    # Weeks with no first day are no schedule.
    half = scheduled(schedule={"start": None, "weeks": WEEKS})
    assert feed.schedule_week(half, START) is None


def test_a_stage_picked_by_hand_holds_until_the_schedules_next_week():
    doc = scheduled()
    wednesday = START + timedelta(days=9)  # week 2: Flower
    feed.pick(doc, "fade", wednesday)
    assert doc["held_until"] == "2026-10-19"  # week 3 starts
    assert feed.in_use(doc, wednesday) == "fade"
    plan = feed.plan(doc, MAPPED, wednesday)
    assert (plan["stage"], plan["source"], plan["held_until"]) == (
        "Fade",
        "held",
        "2026-10-19",
    )
    # Week 3: the schedule takes over again.
    assert feed.in_use(doc, date(2026, 10, 19)) == "flower"
    feed.pick(doc, "flower", wednesday)  # this week's own recipe: no hold
    assert doc["held_until"] is None
    without = feed.pick(settings(), "flower", wednesday)
    assert without["stage"] == "flower" and without["held_until"] is None


@pytest.mark.parametrize(
    "schedule, reason",
    [
        (
            {"start": "2026-10-05", "weeks": ["vege", "gone"]},
            "Week 2 of the feed schedule uses a feed recipe that is not there",
        ),
        ({"start": "5/10/2026", "weeks": ["vege"]}, "first week must be a date"),
        ({"start": None, "weeks": ["vege"] * 53}, "at most 52 weeks"),
        ("weekly", "The feed schedule must be an object"),
    ],
)
def test_a_schedule_that_does_not_make_sense_is_refused(schedule, reason):
    with pytest.raises(ValueError, match=reason):
        scheduled(schedule=schedule)


def test_a_document_saved_before_the_schedule_loads_with_none():
    doc = settings()
    assert doc["schedule"] == {"start": None, "weeks": []} and doc["held_until"] is None
    assert feed.plan(doc, MAPPED, START)["source"] == "hand"


def test_the_select_picks_a_stage_that_holds_until_next_week(dispatcher):
    """The stubs' today is 1 January 2026, a Thursday in week 1 of a schedule from 29 December."""
    store = rig()
    save(
        store,
        recipes=[copy.deepcopy(FLOWER), VEGE],
        stage="vege",
        schedule={"start": "2025-12-29", "weeks": ["vege", "flower"]},
    )
    assert store.in_use() == "vege" and store.plan()["week"] == 1
    asyncio.run(store.set_stage("Flower"))
    assert store.data["held_until"] == "2026-01-05" and store.in_use() == "flower"
    assert store.plan()["source"] == "held"
