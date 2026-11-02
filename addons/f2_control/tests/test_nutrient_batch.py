"""A room's reservoir refill, run by the controller: the fresh water for its fill time, the pump and the
recirculation line joining it half-way once the level shows it is filling, each doser run in the
recipe's order for its planned seconds a pause apart while it still fills (the first one pause after
the pump starts), recirculation until the fill's end and at least a little after the last dose, and
everything switched off in the right order. It starts when "Mix a
Batch Now" is pressed, or by itself when the room's next round of shots would take the reservoir under
its minimum; it refuses to start, and stops part-way, with a reason, whenever that is not safe.

The level is a distance sensor above the water: 125 mm when full and 850 mm when empty here, as on the
owner's GR1 reservoir (the ESPHome template it replaces worked the same percentage out)."""
from datetime import datetime, timedelta, timezone

import pytest

import controller
from crop_steering_engine import ZoneParams, ZoneSnapshot
from test_controller import _build, _desc

KILL = "input_boolean.kill"
DISTANCE = "sensor.res_distance"
FRESH, RECIRC = "switch.mainswater", "switch.recirc"
PUMP, MAIN, VALVE = "switch.p", "switch.m", "switch.v1"
DOSER = {1: "switch.doser_1_power", 2: "switch.doser_2_power"}
PLAN = "sensor.crop_steering_feed_plan"
BUTTON = "button.crop_steering_mix_batch"
AUTO = "switch.crop_steering_auto_batches"
STATUS = "sensor.crop_steering_batch_status"
FULL_MM, EMPTY_MM = 125.0, 850.0
FLOWER = {
    "stage": "Flower",
    "problem": None,
    "fill_s": 60,
    "batch_l": 145.0,
    "full_mm": FULL_MM,
    "empty_mm": EMPTY_MM,
    "min_pct": 5.0,
    "pause_s": 10,
    "mix_s": 10,
    "doses": [
        {"doser": 2, "label": "Bloom", "ml": 100.0, "seconds": 10.0},
        {"doser": 1, "label": "Cleanse", "ml": 50.0, "seconds": 5.0},
    ],
}
# A fill long enough for its doses: its second half (60 s) holds the first one's pause, both doses and
# the pause between them (35 s), and the mix after the last (10 s).
ROOMY = {**FLOWER, "fill_s": 120}


def mm(pct):
    """The distance the sensor reads with the reservoir `pct` full."""
    return f"{FULL_MM + (100.0 - pct) / 100.0 * (EMPTY_MM - FULL_MM):.1f}"


class _Clock(datetime):
    current = None

    @classmethod
    def now(cls, tz=None):
        return cls.current if tz is None else cls.current.astimezone(tz)


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    _Clock.current = _Clock(2026, 9, 27, 14, 0)
    monkeypatch.setattr(controller, "datetime", _Clock)
    seconds = {"now": 0.0}

    def sleep(dt):  # the switch read-backs wait on this: time passes on both clocks
        seconds["now"] += dt
        _Clock.current += timedelta(seconds=dt)

    monkeypatch.setattr(controller.time, "monotonic", lambda: seconds["now"])
    monkeypatch.setattr(controller.time, "sleep", sleep)


def _room(plan=FLOWER, pct=4.0, level=None, auto="off", pressed="unknown", **extra):
    reservoir = {
        "reservoir_distance_sensor": DISTANCE,
        "fresh_water_switch": FRESH,
        "recirc_switch": RECIRC,
        "doser_1_switch": DOSER[1],
        "doser_2_switch": DOSER[2],
    }
    descriptor = _desc(
        enable_flag=KILL,
        pump=PUMP,
        mainline=MAIN,
        valves={"1": VALVE},
        **{**reservoir, **extra},  # a test can unmap one: fresh_water_switch=None
    )
    states = {
        "sensor.crop_steering_engine_config": ("ok", descriptor),
        KILL: ("on", {}),
        DISTANCE: (mm(pct) if level is None else level, {"unit_of_measurement": "mm"}),
        PLAN: ((plan or {}).get("stage") or "none", dict(plan or {})),
        AUTO: (auto, {}),
        BUTTON: (pressed, {}),
        # zone 1's substrate: 40 plants of 3.2 L, so a 1% shot takes 1.28 L from the reservoir
        "number.crop_steering_zone_1_substrate_volume": ("3.2", {}),
        "number.crop_steering_zone_1_plant_count": ("40", {}),
        **{entity: ("off", {}) for entity in (FRESH, RECIRC, PUMP, MAIN, VALVE, *DOSER.values())},
    }
    c, fake = _build({"num_zones": 1, "enable_flag": KILL}, states=states)
    return c, fake, c.rooms[0]


def _tick(c, room):
    c._batch_tick(room, _Clock.now())


def _level(fake, pct):
    fake.set_state(DISTANCE, mm(pct), {"unit_of_measurement": "mm"})


def _press(c, fake, room, ago=0):
    """Press Mix a Batch Now `ago` seconds before the clock's now: Home Assistant stores the time in
    UTC."""
    at = (_Clock.current - timedelta(seconds=ago)).astimezone(timezone.utc)
    fake.set_state(BUTTON, at.isoformat())
    _tick(c, room)


def _later(seconds):
    _Clock.current += timedelta(seconds=seconds)


def _switched(fake):
    return [(d["entity_id"], svc) for dom, svc, d in fake.calls if dom == "switch"]


def _alerts(fake, code):
    return [d for dom, svc, d in fake.calls
            if (dom, svc) == ("persistent_notification", "create") and f"({code})" in d.get("title", "")]


def _dismissed(fake, key):
    return [d for dom, svc, d in fake.calls
            if (dom, svc) == ("persistent_notification", "dismiss") and d.get("notification_id") == f"f2_{key}"]


def _step_on(c, room):
    """Move the clock to the end of the step in progress and tick."""
    _Clock.current = max(_Clock.current, datetime.fromisoformat(room.batch["until"]))
    _tick(c, room)


def _to_end(c, fake, room, pct=88.0):
    """Run a started batch through every step; the level reads `pct` from the half-way check on."""
    _level(fake, pct)
    for _ in range(12):
        if room.batch["step"] == "idle":
            return
        _step_on(c, room)


# ---------------------------------------------------------------- the sequence
def test_a_pressed_button_fills_starts_the_pump_half_way_doses_while_it_fills_and_switches_off_in_order():
    c, fake, room = _room(plan=ROOMY)
    _tick(c, room)  # the button as first seen: never pressed
    assert room.batch["step"] == "idle"
    _press(c, fake, room)
    assert room.batch["step"] == "filling" and fake.states[FRESH][0] == "on"
    fake.calls.clear()
    _level(fake, 88.0)
    while room.batch["step"] != "dosing":
        _step_on(c, room)
    # the first dose goes in while the fresh water still runs, the tank circulating
    assert [fake.states[e][0] for e in (FRESH, PUMP, RECIRC, DOSER[2])] == ["on"] * 4
    _to_end(c, fake, room)
    assert _switched(fake) == [
        (RECIRC, "turn_on"),  # half-way, with the fresh water still running: the line before the pump
        (PUMP, "turn_on"),
        (DOSER[2], "turn_on"),  # one pause later, the recipe's order: Bloom first
        (DOSER[2], "turn_off"),
        (DOSER[1], "turn_on"),
        (DOSER[1], "turn_off"),
        (FRESH, "turn_off"),  # the fill ends
        (PUMP, "turn_off"),  # and the pump stops before its line closes
        (RECIRC, "turn_off"),
    ]
    last = room.batch["last"]
    assert (room.batch["step"], last["result"], last["stage"]) == ("idle", "done", "Flower")
    assert last["dosed"] == {"2": 100.0, "1": 50.0}
    assert all(fake.states[e][0] == "off" for e in (FRESH, RECIRC, PUMP, *DOSER.values()))


def test_each_step_lasts_what_the_plan_says_and_it_is_all_done_when_the_fill_ends():
    c, fake, room = _room(plan=ROOMY)
    _tick(c, room)
    _press(c, fake, room)
    began = start = _Clock.now()
    seen = []
    _level(fake, 88.0)
    while room.batch["step"] != "idle":
        until = datetime.fromisoformat(room.batch["until"])
        seen.append((room.batch["step"], round((until - start).total_seconds())))
        _step_on(c, room)
        start = _Clock.now()
    # half the 120 s fill, a pause before the first dose, Bloom 10 s, a 10 s pause, Cleanse 5 s, each
    # measured from when its step began (the switch read-backs take a second or so each); then it
    # recirculates until the fill's end, and the whole refill takes its fill time
    assert [step for step, _ in seen] == ["filling", "filling_mixing", "dosing", "pausing", "dosing", "mixing"]
    assert [seconds for _, seconds in seen[:5]] == pytest.approx([60, 10, 10, 10, 5], abs=3)
    assert seen[5][1] >= 10
    assert (_Clock.now() - began).total_seconds() == pytest.approx(120, abs=3)


def test_doses_that_outlast_the_fill_go_on_after_the_fresh_water_stops_on_time():
    # 40 s: its second half is over part-way through Bloom
    c, fake, room = _room(plan={**FLOWER, "fill_s": 40})
    _tick(c, room)
    _press(c, fake, room)
    _level(fake, 88.0)
    while room.batch["step"] != "dosing":
        _step_on(c, room)
    fill_end = datetime.fromisoformat(room.batch["fill_end"])
    assert fill_end < datetime.fromisoformat(room.batch["until"])
    # the loop wakes when the fill ends, not when Bloom does
    assert c._sleep_for(_Clock.now()) == pytest.approx((fill_end - _Clock.now()).total_seconds(), abs=0.5)
    _Clock.current = fill_end
    _tick(c, room)
    assert room.batch["step"] == "dosing" and room.batch["fill_end"] is None
    assert [fake.states[e][0] for e in (FRESH, DOSER[2], PUMP)] == ["off", "on", "on"]
    _to_end(c, fake, room)
    last = room.batch["last"]
    assert last["result"] == "done" and last["dosed"] == {"2": 100.0, "1": 50.0}
    assert all(fake.states[e][0] == "off" for e in (FRESH, RECIRC, PUMP, *DOSER.values()))


def test_half_way_a_reservoir_that_is_not_filling_stops_before_the_pump_runs_from_it():
    c, fake, room = _room(pct=4.0)
    _tick(c, room)
    _press(c, fake, room)
    _level(fake, 7.0)  # 3 points in half the fill time: not filling (a dry supply, a stuck solenoid)
    _step_on(c, room)
    assert room.batch["step"] == "idle" and room.batch["last"]["result"] == "stopped: the reservoir did not fill"
    assert (PUMP, "turn_on") not in _switched(fake) and fake.states[FRESH][0] == "off"
    assert not any(entity in DOSER.values() for entity, _ in _switched(fake))
    (note,) = _alerts(fake, "CS-702")
    assert "reads 7% (it started at 4%): it is not filling" in note["message"]
    assert "the pump never started" in note["message"]


def test_half_way_a_level_that_reads_nothing_stops_it_too():
    c, fake, room = _room(pct=4.0)
    _tick(c, room)
    _press(c, fake, room)
    fake.set_state(DISTANCE, "unavailable")
    _step_on(c, room)
    assert room.batch["last"]["result"] == "stopped: the reservoir did not fill"
    assert "reservoir reads nothing" in _alerts(fake, "CS-702")[0]["message"]


def test_a_still_reservoir_reads_however_long_since_its_level_last_changed():
    """GR2, 3 October: the reservoir held at 664.56 mm for hours and the ultrasonic read it every 5 s,
    but Home Assistant's ESPHome integration drops a reading that repeats the last, so the state was
    hours old. 2.32.0 and 2.32.1 read that as a sensor gone. A level is no reading only when Home
    Assistant has none: unavailable, unknown (what ESPHome's timeout filter sends), not a number."""
    c, fake, room = _room(pct=4.0, auto="on")
    hours_ago = (_Clock.current - timedelta(hours=3)).astimezone(timezone.utc).isoformat()
    fake.set_state(DISTANCE, mm(30.0), {"unit_of_measurement": "mm"}, last_updated=hours_ago)
    _tick(c, room)
    assert room._res["pct"] == pytest.approx(30.0)
    fake.set_state(DISTANCE, "unknown", {"unit_of_measurement": "mm"})
    _tick(c, room)
    assert room._res["pct"] is None


def test_without_a_level_set_up_the_fill_goes_by_time_alone():
    plan = {**FLOWER, "full_mm": 0.0, "empty_mm": 0.0}
    c, fake, room = _room(plan=plan, level="500")
    _tick(c, room)
    _press(c, fake, room)  # nothing to check it against: it goes ahead, as it always has
    _step_on(c, room)
    assert room.batch["step"] == "filling_mixing" and fake.states[PUMP][0] == "on"


# ---------------------------------------------------------------- the level
def test_the_level_is_the_percentage_between_the_full_and_empty_distances():
    assert controller.level_pct(125.0, 125.0, 850.0) == 100.0
    assert controller.level_pct(850.0, 125.0, 850.0) == 0.0
    assert controller.level_pct(487.5, 125.0, 850.0) == pytest.approx(50.0)
    assert controller.level_pct(90.0, 125.0, 850.0) == 100.0  # clamped, as the ESPHome template did
    assert controller.level_pct(900.0, 125.0, 850.0) == 0.0
    assert controller.level_pct(None, 125.0, 850.0) is None
    assert controller.level_pct(500.0, 0.0, 850.0) is None  # both distances, or no level
    assert controller.level_pct(500.0, 850.0, 125.0) is None


def test_a_refill_that_went_all_the_way_teaches_what_one_percent_holds():
    c, fake, room = _room(pct=4.0)
    _tick(c, room)
    _press(c, fake, room)
    _to_end(c, fake, room, pct=74.0)  # 145 L raised it 70 points
    assert room.batch["litres_per_pct"] == pytest.approx(145 / 70, abs=0.001)
    assert any("about 2.07 L per 1%" in line for line in c._activity)
    _level(fake, 4.0)
    _tick(c, room)
    _press(c, fake, room)
    _to_end(c, fake, room, pct=84.0)  # the next one says 80 points: averaged with what was known
    assert room.batch["litres_per_pct"] == pytest.approx(0.7 * 145 / 70 + 0.3 * 145 / 80, abs=0.001)


def test_a_refill_that_stopped_or_barely_rose_teaches_nothing():
    c, fake, room = _room(pct=4.0)
    _tick(c, room)
    _press(c, fake, room)
    _level(fake, 12.0)  # rose 8 points: enough to carry on, too little to go by
    _to_end(c, fake, room, pct=12.0)
    assert room.batch["last"]["result"] == "done" and room.batch["litres_per_pct"] is None


# ---------------------------------------------------------------- asked for by hand
def test_before_a_refill_has_shown_what_one_percent_holds_one_asked_for_by_hand_starts_only_from_low():
    c, fake, room = _room(pct=25.0)
    _tick(c, room)
    _press(c, fake, room)
    assert room.batch["step"] == "idle" and _switched(fake) == []
    (note,) = _alerts(fake, "CS-703")
    assert "reads 25%: until a refill has shown how far its 145 L fill raises it" in note["message"]
    assert "only from 10% or less" in note["message"]
    _level(fake, 9.0)
    _later(30)
    _press(c, fake, room)
    assert room.batch["step"] == "filling"


def test_once_it_knows_what_one_percent_holds_the_fill_must_fit():
    c, fake, room = _room(pct=25.0)
    room.batch["litres_per_pct"] = 145 / 70  # a 145 L fill adds 70 points
    _tick(c, room)
    _press(c, fake, room)  # 25 + 70: fits
    assert room.batch["step"] == "filling"
    c2, fake2, room2 = _room(pct=40.0)
    room2.batch["litres_per_pct"] = 145 / 70
    _tick(c2, room2)
    _press(c2, fake2, room2)  # 40 + 70 = 110: it would overflow
    assert room2.batch["step"] == "idle"
    assert "reads 40%, and its 145 L fill adds about 70%, so it could overflow" in _alerts(fake2, "CS-703")[0]["message"]


def test_a_level_set_up_that_reads_nothing_refuses_a_batch_asked_for_by_hand():
    c, fake, room = _room(level="unavailable")
    _tick(c, room)
    _press(c, fake, room)
    assert room.batch["step"] == "idle"
    assert f"the reservoir level ({DISTANCE}) reads nothing" in _alerts(fake, "CS-703")[0]["message"]


def _anyway(fake, after_s=119.0, at=None):
    """The test refill's "Run anyway": the feed plan sensor says so until 120 s after the moment just
    before the press, as the integration's feed_mix(force=True) does."""
    at = at or _Clock.current.astimezone(timezone.utc)
    fake.set_state(PLAN, "Flower", {**FLOWER, "mix_force_until": (at + timedelta(seconds=after_s)).isoformat()})


def test_a_test_refill_run_anyway_starts_where_one_asked_for_by_hand_is_refused():
    c, fake, room = _room(pct=25.0)  # before a refill has shown what 1% holds, 25% is too full
    _tick(c, room)
    _anyway(fake)
    _press(c, fake, room)
    assert room.batch["step"] == "filling" and _alerts(fake, "CS-703") == []
    assert any("(asked for, run anyway): fresh water for 60 s" in line for line in c._activity)


def test_run_anyway_does_not_start_a_refill_whose_level_reads_nothing():
    """Half-way through its fill a refill checks that the reservoir is filling; one whose level reads
    nothing would stop there, the pump never started, with half its fresh water in."""
    c, fake, room = _room(level="unavailable")
    _tick(c, room)
    _anyway(fake)
    _press(c, fake, room)
    assert room.batch["step"] == "idle" and _switched(fake) == []
    assert f"the reservoir level ({DISTANCE}) reads nothing" in _alerts(fake, "CS-703")[0]["message"]


def test_run_anyway_holds_only_for_the_press_it_came_with():
    c, fake, room = _room(pct=25.0)
    _tick(c, room)
    _anyway(fake, at=(_Clock.current - timedelta(minutes=10)).astimezone(timezone.utc))  # an old one
    _press(c, fake, room)
    assert room.batch["step"] == "idle" and _alerts(fake, "CS-703")
    _later(30)
    _anyway(fake, after_s=600)  # not the word feed_mix gives
    _press(c, fake, room)
    assert room.batch["step"] == "idle"


def test_run_anyway_does_not_start_a_refill_that_cannot_run():
    c, fake, room = _room(pct=25.0, auto="off")
    fake.set_state(KILL, "off")
    _tick(c, room)
    _anyway(fake)
    _press(c, fake, room)
    assert room.batch["step"] == "idle" and _switched(fake) == []
    assert f"the room's watering switch ({KILL}) is off" in _alerts(fake, "CS-703")[0]["message"]


def test_the_first_press_seen_is_a_starting_point_but_a_first_press_ever_counts():
    c, fake, room = _room(pressed="2026-09-20T09:00:00+00:00")  # pressed before this controller knew
    _tick(c, room)
    assert room.batch["step"] == "idle"
    fresh, fake2, room2 = _room(pressed="unknown")  # never pressed: the first press is a request
    _tick(fresh, room2)
    _press(fresh, fake2, room2)
    assert room2.batch["step"] == "filling"


def test_a_press_that_waited_while_the_controller_was_stopped_is_not_acted_on():
    c, fake, room = _room()
    _tick(c, room)
    _press(c, fake, room, ago=2 * 3600)
    assert room.batch["step"] == "idle" and _switched(fake) == []
    assert any("too long ago" in line for line in c._activity)
    _press(c, fake, room, ago=60)  # a minute ago: still wanted
    assert room.batch["step"] == "filling"


# ---------------------------------------------------------------- automatic refills
def test_an_automatic_refill_starts_after_three_passes_due_and_waits_until_one_is_not_due_again():
    c, fake, room = _room(pct=4.0, auto="on")  # under the 5% minimum
    for _ in range(2):
        _tick(c, room)
    assert room.batch["step"] == "idle" and room.batch["low_seen"] == 2
    _tick(c, room)
    assert room.batch["step"] == "filling"
    _to_end(c, fake, room, pct=4.0)  # it never rose: stopped half-way, and does not start again
    assert room.batch["last"]["result"] == "stopped: the reservoir did not fill"
    for _ in range(5):
        _tick(c, room)
    assert room.batch["step"] == "idle" and not room.batch["armed"]
    _level(fake, 75.0)  # refilled by hand: re-armed
    _tick(c, room)
    assert room.batch["armed"]


def _filling_room(c, name="GR2"):
    """Another room whose reservoir is taking fresh water: its batch filling, its fill a minute from
    its end."""
    other = controller.Room("gr2", "gr2_", {1: {}}, {"pump": None, "mainline": None, "valves": {1: "switch.gr2_v1"}},
                            "input_boolean.gr2", 10, 22)
    other.room_name = name
    other.batch.update(step="filling", fill_end=(_Clock.current + timedelta(seconds=60)).isoformat())
    c.rooms.append(other)
    return other


WAITS = "reservoir refill waits: GR2's reservoir is taking fresh water, and one room fills at a time"


def test_a_refill_due_while_another_room_takes_fresh_water_waits_and_starts_once_it_stops():
    # Owner, 3 Nov 2026: GR1's refill came due in the minute GR2's started, both filled at once from
    # the one supply, and each got less water than its doses were mixed for.
    c, fake, room = _room(pct=4.0, auto="on")
    other = _filling_room(c)
    for _ in range(5):
        _tick(c, room)
    assert room.batch["step"] == "idle" and _switched(fake) == []
    assert [line for line in c._activity if "refill waits" in line] == [f"14:00 {WAITS}"]  # said once
    other.batch.update(step="mixing", fill_end=None)  # its fresh water stopped: the pump mixes
    _tick(c, room)
    assert room.batch["step"] == "filling"
    assert _switched(fake) == [(FRESH, "turn_on")]


def test_a_refill_asked_for_while_another_room_takes_fresh_water_starts_once_it_stops():
    c, fake, room = _room()
    other = _filling_room(c)
    _tick(c, room)  # the button as first seen: never pressed
    _press(c, fake, room)
    _tick(c, room)
    assert room.batch["step"] == "idle" and _switched(fake) == []
    assert any(WAITS in line for line in c._activity)
    _later(30)
    other.batch.update(step="idle", fill_end=None)  # done
    _tick(c, room)
    assert room.batch["step"] == "filling"
    assert "asked for" in c._activity[0]


def test_a_refill_asked_for_waits_no_longer_than_any_press_is_acted_on():
    c, fake, room = _room()
    other = _filling_room(c)
    _tick(c, room)
    _press(c, fake, room)
    _later(controller.BATCH_REQUEST_S + 60)
    other.batch.update(step="idle", fill_end=None)
    _tick(c, room)
    assert room.batch["step"] == "idle" and _switched(fake) == []
    assert any("too long ago" in line for line in c._activity)


def test_a_room_whose_reservoir_only_mixes_does_not_hold_another_rooms_refill():
    c, fake, room = _room(pct=4.0, auto="on")
    other = _filling_room(c)
    other.batch.update(step="mixing", fill_end=None)
    for _ in range(3):
        _tick(c, room)
    assert room.batch["step"] == "filling"


def test_the_status_says_a_refill_waits_for_another_rooms_fill():
    c, fake, room = _room()
    _filling_room(c)
    _tick(c, room)
    assert fake.sets[STATUS][1]["blocked"] == (
        "GR2's reservoir is taking fresh water, and one room fills at a time"
    )


def _two_rooms():
    """GR1 and GR2, each with its own reservoir, dosers and pump, both under their 5% minimum with
    automatic refills on, filled from the one water supply."""
    states = {}
    for px, name in (("", "GR1"), ("gr2_", "GR2")):
        kill = f"input_boolean.{px}kill"
        res = {
            "reservoir_distance_sensor": f"sensor.{px}res_distance",
            "fresh_water_switch": f"switch.{px}fresh",
            "recirc_switch": f"switch.{px}recirc",
            "doser_1_switch": f"switch.{px}doser_1",
            "doser_2_switch": f"switch.{px}doser_2",
        }
        hw = {"pump": f"switch.{px}pump", "mainline": f"switch.{px}main", "valves": {"1": f"switch.{px}v1"}}
        states[f"sensor.crop_steering_{px}engine_config"] = (
            "ok", _desc(prefix=px, slug=px.rstrip("_") or "default", room_name=name, enable_flag=kill, **hw, **res)
        )
        states[kill] = ("on", {})
        states[res["reservoir_distance_sensor"]] = (mm(4.0), {"unit_of_measurement": "mm"})
        states[f"sensor.crop_steering_{px}feed_plan"] = ("Flower", dict(FLOWER))
        states[f"switch.crop_steering_{px}auto_batches"] = ("on", {})
        states[f"button.crop_steering_{px}mix_batch"] = ("unknown", {})
        states[f"number.crop_steering_{px}zone_1_substrate_volume"] = ("3.2", {})
        states[f"number.crop_steering_{px}zone_1_plant_count"] = ("40", {})
        for entity in (*res.values(), hw["pump"], hw["mainline"], hw["valves"]["1"]):
            if entity != res["reservoir_distance_sensor"]:
                states[entity] = ("off", {})
    c, fake = _build({"num_zones": 1, "enable_flag": "input_boolean.kill"}, states=states)
    return c, fake


def test_two_rooms_due_in_the_same_pass_refill_one_after_the_other():
    c, fake = _two_rooms()
    assert sorted(getattr(r, "room_name", r.slug) for r in c.rooms) == ["GR1", "GR2"]
    for _ in range(3):
        for room in c.rooms:  # as a pass does, first thing
            _tick(c, room)
    first, second = sorted(c.rooms, key=lambda r: r.batch["step"] == "idle")
    assert (first.batch["step"], second.batch["step"]) == ("filling", "idle")
    fresh = [entity for entity, svc in _switched(fake) if svc == "turn_on"]
    assert fresh == [first.batch["switches"]["fresh"]]  # one room's fresh water, not both
    # The first room fills: its level rises, its steps run, and its fresh water stops at the fill's end.
    fake.set_state(first.hw["reservoir"]["distance"], mm(88.0), {"unit_of_measurement": "mm"})
    while first.batch.get("fill_end") is not None:
        _step_on(c, first)
        _tick(c, second)
        if first.batch.get("fill_end") is not None:
            assert second.batch["step"] == "idle"
    _tick(c, second)
    assert second.batch["step"] == "filling"


@pytest.mark.parametrize(
    "here, there, together",
    [("off", "off", True), ("on", "off", False), ("off", "on", False), ("unavailable", "off", False)],
)
def test_two_rooms_fill_together_only_when_both_are_allowed_to(here, there, together):
    # Each room's Refill One Reservoir at a Time switch: either one on keeps them apart, and one that
    # does not answer counts as on.
    c, fake, room = _room(pct=4.0, auto="on")
    other = _filling_room(c)
    fake.set_state("switch.crop_steering_refill_one_at_a_time", here)
    fake.set_state("switch.crop_steering_gr2_refill_one_at_a_time", there)
    for _ in range(3):
        _tick(c, room)
    assert (room.batch["step"] == "filling") is together
    assert other.batch["step"] == "filling"


def test_one_low_reading_starts_nothing():
    c, fake, room = _room(pct=60.0, auto="on")
    _tick(c, room)
    _level(fake, 2.0)  # one bad echo
    _tick(c, room)
    _level(fake, 60.0)
    _tick(c, room)
    _level(fake, 2.0)
    _tick(c, room)
    assert room.batch["step"] == "idle" and room.batch["low_seen"] == 1


def test_with_automatic_refills_off_a_low_reservoir_starts_nothing():
    c, fake, room = _room(pct=2.0, auto="off")
    for _ in range(5):
        _tick(c, room)
    assert room.batch["step"] == "idle" and _switched(fake) == []


def test_with_no_minimum_nothing_is_due():
    c, fake, room = _room(plan={**FLOWER, "min_pct": 0.0}, pct=1.0, auto="on")
    for _ in range(4):
        _tick(c, room)
    assert room.batch["step"] == "idle" and c._refill_due(room) is None


# ---------------------------------------------------------------- planning ahead
def P(**kw):
    d = dict(p1_target=60, p2_threshold=45, p2_shot_size=5, p1_initial=2, p1_incr=0.5, p1_max_shots=6,
             p1_time_between_min=15, dryback_target=20, p0_max_wait_min=45, ec_target_p0=4, ec_target_p1=6,
             ec_target_p2=6, p3_emergency_floor=40, p3_emergency_shot=2, max_daily_volume=300,
             field_capacity=70, max_ec=9, stacking_on=False)
    d.update(kw)
    return ZoneParams(**d)


def S(**kw):
    d = dict(vwc=50, ec=6, phase="P1", peak_vwc=60, dryback_pct=0, dryback_rate=2, shot_count=0,
             phase_minutes=5, minutes_since_shot=99, daily_vol=0, ec_smooth=6, lights_on=True,
             lights_just_on=False, hours_to_lights_on=8, hours_to_lights_off=8, uptime_min=60)
    d.update(kw)
    return ZoneSnapshot(**d)


def _round(c, room, phase, shots, snap=True):
    room.state[1].update(phase=phase, shots=shots)
    snaps = {1: S(phase=phase, shot_count=shots)} if snap else {}
    return c._plan_next_round(room, snaps, {1: P()})


def test_the_next_round_is_each_zones_next_shot_as_the_engine_would_size_it():
    c, fake, room = _room()
    one_pct = c._shot_litres(room, 1, 1.0)
    assert one_pct == pytest.approx(1.28)
    assert _round(c, room, "P1", 3) == pytest.approx(3.5 * one_pct)  # the 4th ramp shot: 2 + 3 x 0.5
    assert _round(c, room, "P1", 6) == pytest.approx(5 * one_pct)  # every ramp shot in: P2's next
    assert _round(c, room, "P2", 0) == pytest.approx(5 * one_pct)
    assert _round(c, room, "P3", 0) == pytest.approx(2 * one_pct)  # a hold or rescue shot overnight
    assert _round(c, room, "P0", 0) == pytest.approx(2 * one_pct)  # the morning's first ramp shot
    assert _round(c, room, "P2", 0, snap=False) == pytest.approx(5 * one_pct)  # no probe: a maintenance shot


def test_mid_ramp_a_refill_starts_when_the_next_ramp_shot_would_not_fit():
    """After its 3rd P1 shot a zone's 4th (3.5% of 128 L, 4.48 L) would take the reservoir from 7% to
    under its 5%: the refill starts between the two shots, three passes on, instead of when the 4th
    is due. With 2.07 L per 1% the 4th takes 2.2 points."""
    c, fake, room = _room(pct=7.0, auto="on")
    room.batch["litres_per_pct"] = 145 / 70
    room._next_round_l = _round(c, room, "P1", 3)
    for _ in range(3):
        _tick(c, room)
    assert room.batch["step"] == "filling"
    assert c._refill_why(room) == (
        "the reservoir reads 7%, and the next round of shots (4.5 L) would take it under its 5% minimum")


def test_a_round_that_fits_starts_nothing():
    c, fake, room = _room(pct=9.0, auto="on")
    room.batch["litres_per_pct"] = 145 / 70
    room._next_round_l = _round(c, room, "P0", 0)  # 2.56 L: 1.2 points, 9 -> 7.8
    for _ in range(4):
        _tick(c, room)
    assert room.batch["step"] == "idle"


# ---------------------------------------------------------------- before each shot
def test_a_shot_that_would_take_the_reservoir_under_its_minimum_waits_for_the_refill():
    c, fake, room = _room(pct=7.0, auto="on")
    room.batch["litres_per_pct"] = 145 / 70
    _tick(c, room)
    room._drawn_l = room._waiting_l = 0.0
    assert c._reservoir_block(room, 1, 1.0) is None  # 1.28 L: 0.6 points
    hold = c._reservoir_block(room, 1, 3.5)  # 4.48 L: 2.2 points, under 5%
    assert hold == "waiting for a reservoir refill: the reservoir reads 7%, and this shot would take it under its 5% minimum"
    assert room._waiting_l == pytest.approx(4.48) and c._refill_due(room) is True
    assert not _alerts(fake, "CS-704")  # a refill is coming: nothing to raise


def test_the_shots_this_pass_has_already_taken_count():
    c, fake, room = _room(pct=8.0, auto="on")
    room.batch["litres_per_pct"] = 145 / 70
    _tick(c, room)
    room._waiting_l = 0.0
    assert c._reservoir_block(room, 1, 1.0) is None  # 8 - 1.28 / 2.07 = 7.4
    room._drawn_l = 6.0  # an earlier zone's shot this pass, not yet on the level sensor
    assert c._reservoir_block(room, 1, 1.0) is not None  # 8 - (6 + 1.28) / 2.07 = 4.5


def test_without_automatic_refills_watering_is_held_and_said_so_until_it_reads_enough():
    c, fake, room = _room(pct=4.0, auto="off")
    _tick(c, room)
    room._drawn_l = room._waiting_l = 0.0
    hold = c._reservoir_block(room, 1, 1.0)
    assert hold == ("reservoir too low: the reservoir reads 4%, under its 5% minimum "
                    "(automatic refills are off)")
    (note,) = _alerts(fake, "CS-704")
    assert "no zone is watered from it: a pump that runs it dry loses its prime" in note["message"]
    _level(fake, 70.0)  # refilled by hand
    _tick(c, room)
    assert _dismissed(fake, f"res_low_{room.slug}")
    assert c._reservoir_block(room, 1, 1.0) is None


def test_a_refill_that_did_not_raise_it_holds_watering_rather_than_trying_again():
    c, fake, room = _room(pct=4.0, auto="on")
    room.batch["armed"] = False  # the last refill stopped: the reservoir did not fill
    _tick(c, room)
    room._drawn_l = room._waiting_l = 0.0
    assert c._reservoir_block(room, 1, 1.0).endswith("(the last refill did not raise it)")
    assert _alerts(fake, "CS-704")


def test_with_no_level_or_no_minimum_a_shot_never_waits_for_the_reservoir():
    for plan, level in (({**FLOWER, "min_pct": 0.0}, mm(1.0)), (FLOWER, "unavailable"),
                        ({**FLOWER, "full_mm": 0.0}, mm(1.0))):
        c, fake, room = _room(plan=plan, level=level, auto="on")
        _tick(c, room)
        room._drawn_l = room._waiting_l = 0.0
        assert c._reservoir_block(room, 1, 5.0) is None


# ---------------------------------------------------------------- the level sensor
def test_a_level_that_reads_nothing_for_five_minutes_is_said_once_and_watering_carries_on():
    c, fake, room = _room(level="unavailable", auto="on")
    for _ in range(4):
        _tick(c, room)
    assert not _alerts(fake, "CS-705")
    _tick(c, room)
    (note,) = _alerts(fake, "CS-705")
    assert f"level sensor ({DISTANCE}) has read nothing for 5 minutes. Watering carries on" in note["message"]
    _tick(c, room)
    assert len(_alerts(fake, "CS-705")) == 1
    _level(fake, 60.0)
    _tick(c, room)
    assert _dismissed(fake, f"res_level_{room.slug}")


def test_a_level_that_is_not_set_up_is_never_reported():
    c, fake, room = _room(plan={**FLOWER, "full_mm": 0.0}, level="unavailable")
    for _ in range(8):
        _tick(c, room)
    assert not _alerts(fake, "CS-705")


# ---------------------------------------------------------------- refusing and stopping
@pytest.mark.parametrize(
    "change, reason",
    [
        ({KILL: "off"}, f"the room's watering switch ({KILL}) is off"),
        ({PUMP: "on"}, f"{PUMP} reads on, not off"),
        ({VALVE: "on"}, f"{VALVE} reads on, not off"),
        ({DOSER[2]: "unavailable"}, f"{DOSER[2]} reads unavailable, not off"),
    ],
)
def test_it_refuses_to_start_with_a_reason_and_switches_nothing_on(change, reason):
    c, fake, room = _room()
    _tick(c, room)
    for entity, state in change.items():
        fake.set_state(entity, state)
    _press(c, fake, room)
    assert room.batch["step"] == "idle"
    assert not [call for call in _switched(fake) if call[1] == "turn_on"]
    (note,) = _alerts(fake, "CS-703")
    assert reason in note["message"]
    assert fake.sets[STATUS][1]["blocked"] == reason


def test_a_plan_the_integration_cannot_run_is_refused_in_its_own_words():
    plan = {**FLOWER, "stage": None, "problem": "No feed stage is chosen.", "doses": []}
    c, fake, room = _room(plan=plan)
    _tick(c, room)
    _press(c, fake, room)
    (note,) = _alerts(fake, "CS-703")
    assert "could not start: No feed stage is chosen." in note["message"]


def test_switching_watering_off_mid_dose_stops_it_and_counts_what_went_in():
    c, fake, room = _room()
    _tick(c, room)
    _press(c, fake, room)
    _level(fake, 88.0)
    while room.batch["step"] != "dosing":
        _step_on(c, room)
    _later(4)  # Bloom has run about 4 of its 10 s
    assert fake.states[FRESH][0] == "on"  # the doses go in while it fills
    fake.set_state(KILL, "off")
    _tick(c, room)
    assert room.batch["step"] == "idle"
    assert all(fake.states[e][0] == "off" for e in (DOSER[2], FRESH, PUMP, RECIRC))
    assert 30 <= room.batch["last"]["dosed"]["2"] <= 70  # 100 mL in 10 s, stopped part-way
    bloom, cleanse = room.batch["last"]["doses"]
    assert (bloom["label"], cleanse["label"]) == ("Bloom", "Cleanse")
    assert bloom["given"] == room.batch["last"]["dosed"]["2"] and cleanse["given"] is None
    (note,) = _alerts(fake, "CS-701")
    assert "while dosing" in note["message"] and "was switched off" in note["message"]
    assert f"Given so far: Bloom {bloom['given']:g} mL." in note["message"]


def test_the_last_batch_names_each_nutrient_in_the_order_it_went_in():
    c, fake, room = _room(plan=ROOMY)
    _tick(c, room)
    _press(c, fake, room)
    _to_end(c, fake, room)
    assert room.batch["last"]["doses"] == [
        {"doser": 2, "label": "Bloom", "ml": 100.0, "given": 100.0},
        {"doser": 1, "label": "Cleanse", "ml": 50.0, "given": 50.0},
    ]


def test_a_dose_that_ran_its_time_gave_the_recipes_amount_however_late_it_was_switched_off():
    """The controller switches a doser off a little after its time. That is not counted as more: the
    record read 121 mL where the recipe said 120."""
    c, fake, room = _room(plan=ROOMY)
    _tick(c, room)
    _press(c, fake, room)
    _level(fake, 88.0)
    while room.batch["step"] != "dosing":
        _step_on(c, room)
    _Clock.current = datetime.fromisoformat(room.batch["until"]) + timedelta(seconds=0.4)
    _tick(c, room)
    assert room.batch["step"] != "dosing" or room.batch["index"] == 1
    assert room.batch["dosed"]["2"] == 100.0


def test_switching_watering_off_in_the_second_half_of_the_fill_stops_the_water_and_the_pump():
    c, fake, room = _room()
    _tick(c, room)
    _press(c, fake, room)
    _level(fake, 50.0)
    _step_on(c, room)
    assert room.batch["step"] == "filling_mixing"
    fake.set_state(KILL, "off")
    _tick(c, room)
    assert all(fake.states[e][0] == "off" for e in (FRESH, PUMP, RECIRC))
    assert "while filling" in _alerts(fake, "CS-701")[0]["message"]


def test_a_doser_that_will_not_switch_off_latches_the_hardware_hold():
    c, fake, room = _room()
    _tick(c, room)
    _press(c, fake, room)
    _level(fake, 88.0)
    while room.batch["step"] != "dosing":
        _step_on(c, room)
    plain = controller.ha_call

    def stuck(domain, service, **data):  # the doser's relay reports on whatever it is told
        if data.get("entity_id") == DOSER[2] and service == "turn_off":
            fake.calls.append((domain, service, data))
            return True
        return plain(domain, service, **data)

    controller.ha_call = stuck
    try:
        _Clock.current = datetime.fromisoformat(room.batch["until"])
        _tick(c, room)
    finally:
        controller.ha_call = plain
    assert room.batch["step"] == "idle" and room.hardware_fault
    assert DOSER[2] in room.hardware_fault["reason"]
    assert _alerts(fake, "CS-301") and _alerts(fake, "CS-701")


def test_while_it_refills_the_rooms_shots_wait_and_other_rooms_while_it_fills_or_doses():
    c, fake, room = _room()
    other = controller.Room("veg", "veg_", {1: {}}, {"pump": None, "mainline": None, "valves": {1: "switch.veg_v1"}},
                            "input_boolean.veg", 10, 22)
    c.rooms.append(other)
    room.room_name = "GR1"
    _tick(c, room)
    _press(c, fake, room)
    assert c._batch_hold(room) == "refilling its reservoir (filling)"
    assert c._batch_hold(other) == "waiting for GR1's reservoir refill (filling)"
    _level(fake, 88.0)
    _step_on(c, room)
    assert c._batch_hold(other) == "waiting for GR1's reservoir refill (filling and mixing)"
    _step_on(c, room)
    assert c._batch_hold(other) == "waiting for GR1's reservoir refill (dosing)"
    _step_on(c, room)  # between dosers, with the fresh water still running
    assert c._batch_hold(other) == "waiting for GR1's reservoir refill (between dosers)"
    while room.batch["step"] != "mixing":
        _step_on(c, room)
    # recirculating once the fill has ended and the last dose is in: nothing timed runs
    assert room.batch["fill_end"] is None
    assert c._batch_hold(room) == "refilling its reservoir (mixing)"
    assert c._batch_hold(other) is None


def test_between_passes_switching_watering_off_stops_the_fill_within_seconds():
    c, fake, room = _room()
    _tick(c, room)
    _press(c, fake, room)
    start = _Clock.now()
    fake.set_state(KILL, "off")
    c._wait_for_next_pass()  # the pass would come after the fill's first half
    assert room.batch["step"] == "idle" and fake.states[FRESH][0] == "off"
    stopped = datetime.fromisoformat(room.batch["last"]["at"])
    assert (stopped - start).total_seconds() <= controller.BATCH_WATCH_S + 1
    (note,) = _alerts(fake, "CS-701")
    assert "while filling" in note["message"] and fake.sets[STATUS][0] == "idle"


def test_with_no_batch_filling_or_dosing_the_loop_sleeps_its_whole_interval():
    c, fake, room = _room(pct=60.0)
    _tick(c, room)
    start = _Clock.now()
    c._wait_for_next_pass()
    assert (_Clock.now() - start).total_seconds() == pytest.approx(c.loop_seconds)
    assert not [call for call in fake.calls if call[0] != "persistent_notification"]


def test_the_loop_wakes_when_a_step_is_due():
    c, fake, room = _room()
    assert c._sleep_for(_Clock.now()) == c.loop_seconds
    _tick(c, room)
    _press(c, fake, room)
    assert c._sleep_for(_Clock.now()) == pytest.approx(30, abs=2)  # half-way through the fill


def test_a_batch_saved_in_progress_is_switched_off_at_the_next_start(tmp_path):
    c, fake, room = _room()
    _tick(c, room)
    _press(c, fake, room)
    c._save_state()
    again = controller.Controller.__new__(controller.Controller)
    again.__dict__.update(c.__dict__)
    again.rooms = [controller.Room("default", "", room.zones, room.hw, KILL, 10, 22)]
    again._load_state()  # the process died filling
    assert again.rooms[0]._batch_crashed
    _tick(again, again.rooms[0])
    assert again.rooms[0].batch["step"] == "idle"
    assert fake.states[FRESH][0] == "off"
    (note,) = _alerts(fake, "CS-701")
    assert "the controller app stopped without finishing it" in note["message"]


def test_stopping_the_app_mid_batch_switches_it_off_and_says_so_once_at_the_next_start():
    c, fake, room = _room()
    _tick(c, room)
    _press(c, fake, room)
    c._safe_off()
    assert fake.states[FRESH][0] == "off" and room.batch["step"] == "idle"
    assert room.batch["interrupted"]["step"] == "filling"
    _tick(c, room)
    _tick(c, room)
    assert len(_alerts(fake, "CS-701")) == 1 and room.batch["interrupted"] is None


# ---------------------------------------------------------------- the refill reminder (CS-706)
REMINDING = {**FLOWER, "remind_pct": 20.0}


def _passes(c, room, count=1):
    """`count` passes of the loop, a minute apart."""
    for _ in range(count):
        _tick(c, room)
        _later(60)


def test_with_automatic_refills_off_a_low_reservoir_reminds_after_three_passes_and_not_every_pass():
    c, fake, room = _room(plan=REMINDING, pct=19.0)
    _passes(c, room, 2)
    assert not _alerts(fake, "CS-706")  # one bad echo is not a low reservoir
    _passes(c, room)
    (alert,) = _alerts(fake, "CS-706")
    assert alert["title"] == "Reservoir down to 19%, refill it (CS-706)"
    assert alert["message"].startswith(
        "The reservoir is down to 19%: refill it by hand. Watering stops at its 5% minimum. It comes "
        "again each day it stays at or under 20%, and goes once it reads 25%."
    )
    _passes(c, room, 90)
    assert len(_alerts(fake, "CS-706")) == 1  # not each pass, nor each half hour


def test_once_a_refill_has_shown_what_one_percent_holds_it_says_the_litres_and_rounds_left():
    c, fake, room = _room(plan=REMINDING, pct=20.0)
    room.batch["litres_per_pct"] = 2.07  # 41 L at 20%, as the owner's 145 L fills showed
    room._next_round_l = 5.0  # the room's next round of shots
    _passes(c, room, 3)
    (alert,) = _alerts(fake, "CS-706")
    assert alert["message"].startswith(
        "The reservoir is down to 20% (about 41 L): refill it by hand. Watering stops at its 5% "
        "minimum, about 6 rounds of shots from now."  # 15 points of 2.07 L, 5 L a round
    )
    _level(fake, 90.0)  # refilled, then run down again by a room drinking 40 L a round
    _passes(c, room)
    room._next_round_l = 40.0
    _level(fake, 20.0)
    _passes(c, room, 3)
    assert "Watering stops at its 5% minimum, within the next round of shots." in (
        _alerts(fake, "CS-706")[-1]["message"]
    )


def test_it_comes_again_each_day_it_stays_low_and_a_restart_does_not_say_it_sooner():
    c, fake, room = _room(plan=REMINDING, pct=18.0)
    _passes(c, room, 3)
    assert len(_alerts(fake, "CS-706")) == 1
    _later(20 * 3600)
    again = controller.Controller.__new__(controller.Controller)
    again.__dict__.update(c.__dict__)
    again._alerted, again._alert_codes = {}, {}  # a new process remembers no notification
    again.rooms = [controller.Room("default", "", room.zones, room.hw, KILL, 10, 22)]
    again._load_state()
    room = again.rooms[0]
    _passes(again, room, 5)
    assert len(_alerts(fake, "CS-706")) == 1  # said 20 hours ago: kept across the restart
    _later(4 * 3600)
    _passes(again, room, 1)
    assert len(_alerts(fake, "CS-706")) == 2  # a day on, it comes again


def test_it_goes_once_the_reservoir_reads_five_points_above_and_then_can_come_again():
    c, fake, room = _room(plan=REMINDING, pct=19.0)
    _passes(c, room, 3)
    assert len(_alerts(fake, "CS-706")) == 1
    _level(fake, 23.0)  # topped up a little: still under 25%, the reminder stays up
    _passes(c, room, 3)
    assert room.batch["reminded_at"] is not None and not _dismissed(fake, "res_remind_default")
    _level(fake, 90.0)  # refilled by hand
    _passes(c, room)
    assert room.batch["reminded_at"] is None and len(_dismissed(fake, "res_remind_default")) == 1
    _level(fake, 20.0)  # run down again: the next time it reminds at once, not a day after the last
    _passes(c, room, 3)
    assert len(_alerts(fake, "CS-706")) == 2


def test_never_while_automatic_refills_keep_it_up_but_a_room_with_nothing_to_refill_with_is_reminded():
    c, fake, room = _room(plan=REMINDING, pct=19.0, auto="on")
    _passes(c, room, 5)
    assert not _alerts(fake, "CS-706")
    # automatic refills on, but no fresh-water solenoid: nothing refills it by itself
    c, fake, room = _room(plan=REMINDING, pct=19.0, auto="on", fresh_water_switch=None)
    _passes(c, room, 3)
    assert len(_alerts(fake, "CS-706")) == 1
    # a reminder up when automatic refills are turned on goes
    c, fake, room = _room(plan=REMINDING, pct=19.0)
    _passes(c, room, 3)
    fake.set_state(AUTO, "on")
    _passes(c, room)
    assert room.batch["reminded_at"] is None and len(_dismissed(fake, "res_remind_default")) == 1


@pytest.mark.parametrize(
    "plan, level, room_active",
    [
        ({**REMINDING, "remind_pct": 0.0}, mm(10.0), "on"),  # turned off
        ({**REMINDING, "min_pct": 20.0}, mm(10.0), "on"),  # at the minimum: watering waits (CS-704)
        (REMINDING, "unavailable", "on"),  # the level reads nothing (CS-705 says so)
        (REMINDING, mm(10.0), "off"),  # the room is switched off: no alerts
    ],
)
def test_no_reminder_when_it_is_off_at_the_minimum_unreadable_or_the_room_is_off(plan, level, room_active):
    c, fake, room = _room(plan=plan, level=level)
    fake.set_state("switch.crop_steering_room_active", room_active)
    _passes(c, room, 5)
    assert not _alerts(fake, "CS-706") and room.batch["reminded_at"] is None


# ---------------------------------------------------------------- what it publishes and keeps
def test_the_status_sensor_says_how_full_it_is_what_runs_and_what_went_in():
    c, fake, room = _room(pct=40.0)
    room.batch["litres_per_pct"] = 2.07
    _tick(c, room)
    state, attrs = fake.sets[STATUS]
    assert state == "idle" and attrs["stage"] == "Flower" and attrs["level_mm"] == pytest.approx(560.0)
    assert (attrs["level_pct"], attrs["full_mm"], attrs["empty_mm"], attrs["min_pct"]) == (40.0, 125.0, 850.0, 5.0)
    assert attrs["litres_per_pct"] == 2.07 and attrs["due"] is False
    assert attrs["blocked"] is None and attrs["auto"] is False
    _level(fake, 9.0)
    _tick(c, room)
    _press(c, fake, room)
    state, attrs = fake.sets[STATUS]
    # the times carry their UTC offset, so a browser in another time zone reads the same moment
    until = datetime.fromisoformat(attrs["until"])
    assert state == "filling" and until.utcoffset() is not None and attrs["due"] is None
    assert abs((until - datetime.fromisoformat(room.batch["until"]).astimezone()).total_seconds()) < 1
    # when the fresh water stops: the doses go in before then
    fill_until = datetime.fromisoformat(attrs["fill_until"])
    assert abs((fill_until - datetime.fromisoformat(room.batch["fill_end"]).astimezone()).total_seconds()) < 1
    _to_end(c, fake, room)
    assert fake.sets[STATUS][1]["fill_until"] is None
    last = fake.sets[STATUS][1]["last"]
    assert last["result"] == "done" and datetime.fromisoformat(last["at"]).utcoffset() is not None
    assert last["dosed"] == {"2": 100.0, "1": 50.0}


def test_an_old_state_file_or_a_damaged_batch_record_loads_as_no_batch():
    assert controller.restore_batch(None) == controller.fresh_batch()
    damaged = controller.restore_batch({"step": "flooding", "index": "two", "armed": "yes", "plan": 5,
                                        "litres_per_pct": -2, "start_pct": "low", "fill_end": 7,
                                        "reminded_at": 7})
    assert damaged["step"] == "idle" and damaged["index"] == 0 and damaged["armed"] is True
    assert damaged["plan"] is None and damaged["litres_per_pct"] is None
    assert damaged["start_pct"] is None and damaged["fill_end"] is None and damaged["reminded_at"] is None
    # A record from before the level: no litres per 1% yet. One an older controller saved settling
    # is kept, so the next start switches that batch off.
    old = controller.restore_batch({"step": "settling", "armed": False, "low_seen": 1})
    assert (old["step"], old["armed"], old["litres_per_pct"]) == ("settling", False, None)
    assert old["reminded_at"] is None  # from before the refill reminder: none is up
    assert controller.restore_batch({"litres_per_pct": 2.07})["litres_per_pct"] == 2.07


def test_a_plan_with_a_dose_it_cannot_read_is_not_run():
    assert controller.feed_plan({**FLOWER, "doses": [{"doser": 9, "ml": 1, "seconds": 1}]}) is None
    assert controller.feed_plan({**FLOWER, "doses": [{"doser": 1, "ml": 1, "seconds": 99999}]}) is None
    assert controller.feed_plan({**FLOWER, "fill_s": "soon"}) is None
    assert controller.feed_plan(FLOWER)["doses"][0]["label"] == "Bloom"


def test_a_plan_from_an_integration_before_the_level_reads_as_no_level_and_no_minimum():
    old = {key: value for key, value in FLOWER.items() if key not in ("full_mm", "min_pct")}
    plan = controller.feed_plan({**old, "settle_s": 20, "empty_mm": 800})
    assert (plan["full_mm"], plan["empty_mm"], plan["min_pct"]) == (0.0, 800.0, 0.0)


def test_a_plan_from_an_integration_before_the_refill_reminder_reads_as_no_reminder():
    assert controller.feed_plan(FLOWER)["remind_pct"] == 0.0
    assert controller.feed_plan(REMINDING)["remind_pct"] == 20.0


def test_a_distance_in_cm_or_m_reads_in_mm():
    assert controller.level_mm(("84.6", {"unit_of_measurement": "cm"})) == pytest.approx(846.0)
    assert controller.level_mm(("0.85", {"unit_of_measurement": "m"})) == pytest.approx(850.0)
    assert controller.level_mm(("850", {"unit_of_measurement": "in"})) is None
    assert controller.level_mm(("unavailable", {})) is None


def test_a_room_without_a_reservoir_keeps_its_fingerprint_and_one_with_it_names_it():
    plain = _desc(enable_flag=KILL)
    room = type("R", (), {"enable_flag": KILL})()
    assert "reservoir" not in controller.Controller._setup_fingerprint(plain, room)
    mapped = controller.Controller._setup_fingerprint({**plain, "fresh_water_switch": FRESH}, room)
    assert FRESH in mapped


def test_in_a_pass_a_shot_due_waits_for_the_reservoir_and_the_next_round_is_planned(monkeypatch):
    """The whole pass, with nothing else in the way: zone 1 in P2 reads under its trigger and would
    top up, but the reservoir reads under its minimum with automatic refills off. The shot is held
    and said so, nothing opens, and the pass plans the next round from where the zone is."""
    c, fake, room = _room(pct=4.0, auto="off")
    fake.set_state("sensor.crop_steering_vwc_zone_1", "40", {"unit_of_measurement": "%"},
                   last_updated=_Clock.now(timezone.utc).isoformat())
    room.state[1].update(phase="P2", last_daily_reset=_Clock.now().date())
    monkeypatch.setattr(c, "_blocked", lambda room, zone, reason=None: None)
    c.loop_once(_Clock.now())
    assert not [call for call in _switched(fake) if call[1] == "turn_on"]
    label, attrs = fake.sets["sensor.crop_steering_zone_1_status_app"]
    assert label.startswith("Blocked: reservoir too low: the reservoir reads 4%, under its 5% minimum")
    assert _alerts(fake, "CS-704")
    assert room._next_round_l == pytest.approx(5 * 1.28)  # a P2 maintenance shot of 128 L of substrate


# ----------------------------------------------------------------- the feed recipe's feed EC
def test_the_feed_plan_carries_the_feed_ec_of_the_recipe_in_use():
    assert controller.feed_plan({**FLOWER, "feed_ec": 1.6})["feed_ec"] == 1.6
    # Not given, not a number, or outside what a recipe accepts (0.1 to 10 mS/cm): none.
    for given in (None, "", "soon", 0, 0.05, 11, float("nan")):
        assert controller.feed_plan({**FLOWER, "feed_ec": given})["feed_ec"] is None
    assert controller.feed_plan(FLOWER)["feed_ec"] is None  # an integration from before has none


def test_a_zone_flushes_and_dilutes_with_the_feed_its_recipe_mixes_to():
    """The engine floods a salty substrate only with a feed weaker than it. A 1.6 mS/cm feed dilutes a
    2.6 substrate; counted as 3.0, as it was before recipes gave their EC, the same feed did not."""
    import dataclasses

    from crop_steering_engine import decide

    c, fake, room = _room(plan={**ROOMY, "feed_ec": 1.6}, pct=60.0)
    fake.set_state("sensor.crop_steering_vwc_zone_1", "55", {"unit_of_measurement": "%"},
                   last_updated=_Clock.now(timezone.utc).isoformat())
    _tick(c, room)  # first in every pass: it reads the room's feed plan
    snap, p = c._snapshot(room, 1, _Clock.now(), True, False)
    assert snap.feed_ec == 1.6
    # P2, a settled substrate EC of 2.6 against a P2 target of 2.0: 30% over, so a diluting shot is due.
    snap = dataclasses.replace(snap, phase="P2", ec=2.6, ec_settled=2.6, minutes_since_shot=120.0)
    p = dataclasses.replace(p, ec_target_p2=2.0, p2_threshold=50.0, field_capacity=70.0)
    assert decide(snap, p)[4].kind == "p2_dilute"
    assert decide(dataclasses.replace(snap, feed_ec=3.0), p)[4].kind != "p2_dilute"


def test_a_recipe_without_a_feed_ec_leaves_the_feed_counted_as_3():
    c, fake, room = _room(plan=ROOMY, pct=60.0)
    fake.set_state("sensor.crop_steering_vwc_zone_1", "55", {"unit_of_measurement": "%"},
                   last_updated=_Clock.now(timezone.utc).isoformat())
    _tick(c, room)
    snap, _p = c._snapshot(room, 1, _Clock.now(), True, False)
    assert snap.feed_ec == ZoneSnapshot.__dataclass_fields__["feed_ec"].default == 3.0
