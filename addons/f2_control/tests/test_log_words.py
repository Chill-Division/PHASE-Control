"""The controller's log in plain words (log_words.py, and where controller.py says it): each line
dated, the room and zone by the names the operator gave them, every zone's readings and what it waits
for each minute, why a zone changed phase or fired, and who changed a setting.

The transitions, shots and holds are the engine's own: these run decide() for them, so a change to the
engine's texts that the log would no longer recognise fails here, not quietly in a live log. The
setting names are the dashboard's, read from its own file."""

import re
from datetime import datetime, timezone
from pathlib import Path

import pytest

import controller
import log_words
from crop_steering_engine import Reason, ZoneParams, ZoneSnapshot, decide
from test_controller import _build, _desc

ROOT = Path(__file__).resolve().parents[3]
WORDS = (ROOT / "frontend" / "src" / "lib" / "setting-words.ts").read_text(encoding="utf-8")
STAMP = r"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d"


def P(**kw):
    d = dict(
        p1_target=60,
        p2_threshold=45,
        p2_shot_size=5,
        p1_initial=2,
        p1_incr=0.5,
        p1_max_shots=12,
        p1_time_between_min=15,
        dryback_target=20,
        p0_max_wait_min=45,
        ec_target_p0=4,
        ec_target_p1=5,
        ec_target_p2=6,
        p3_emergency_floor=40,
        p3_emergency_shot=2,
        max_daily_volume=300,
        field_capacity=70,
        max_ec=9,
        stacking_on=False,
    )
    d.update(kw)
    return ZoneParams(**d)


def S(**kw):
    d = dict(
        vwc=50,
        ec=6,
        phase="P2",
        peak_vwc=60,
        dryback_pct=0,
        dryback_rate=2,
        shot_count=0,
        phase_minutes=5,
        minutes_since_shot=99,
        daily_vol=0,
        ec_smooth=6,
        lights_on=True,
        lights_just_on=False,
        hours_to_lights_on=8,
        hours_to_lights_off=8,
        uptime_min=60,
    )
    d.update(kw)
    return ZoneSnapshot(**d)


@pytest.mark.parametrize(
    "snap, words",
    [
        (S(phase="P2", lights_on=False), "lights off"),
        (S(phase="P3", lights_just_on=True), "lights on"),
        (
            S(phase="P0", vwc=44),
            "VWC 44% is at or under the maintenance trigger (45%), no morning dryback needed",
        ),
        (S(phase="P0", vwc=50, dryback_pct=25), "the morning dryback reached 25.0%"),
        (S(phase="P0", vwc=55, phase_minutes=50), "the latest first shot came, 50 min into P0"),
        (
            S(phase="P1", vwc=61, ec=5, shot_count=3),
            "VWC 61% reached the 60% peak target, EC 5.0 back in range",
        ),
        (S(phase="P1", vwc=50, shot_count=12), "all 12 ramp shots are in"),
    ],
)
def test_a_phase_change_says_why(snap, words):
    new_phase, _, _, _, reason = decide(snap, P())
    assert new_phase != snap.phase
    assert log_words.transition(reason) == words


@pytest.mark.parametrize(
    "snap, said",
    [
        (S(phase="P1", vwc=50, ec=5), ("ramp shot", "VWC 50% under the 60% peak target")),
        (S(phase="P2", vwc=40), ("maintenance shot", "VWC 40% under the 45% maintenance trigger")),
        (S(phase="P3", vwc=35, lights_on=False), ("rescue shot", "VWC 35% under the 40% rescue level")),
        (
            S(phase="P3", vwc=45, lights_on=False),
            ("dryback hold shot", "VWC 45.0% under 48.0%, the 20% P3 dryback from today's 60.0% peak"),
        ),
        (
            S(phase="P2", vwc=40, ec=None, ec_smooth=None),
            (
                "maintenance shot",
                "VWC 40% under the 45% maintenance trigger; EC unknown, watering by moisture alone",
            ),
        ),
    ],
)
def test_a_shot_says_what_it_is_and_why(snap, said):
    _, _, fire, _, reason = decide(snap, P())
    assert fire
    assert log_words.shot(reason) == said


def test_a_held_zone_says_why_and_a_quiet_one_nothing():
    _, _, fire, _, reason = decide(S(phase="P2", vwc=40, daily_vol=300), P())
    assert not fire and reason.kind == "block_daily_cap"
    assert log_words.hold(reason) == (
        "the daily water limit is spent (300 of 300 L); rescue shots still run"
    )
    _, _, fire, _, reason = decide(S(phase="P2", vwc=69, ec=10), P())
    assert not fire and reason.kind == "block_high_ec"
    assert log_words.hold(reason) == (
        "EC 10.0 over the maximum and a flush can't bring it down now (slab saturated), "
        "so nothing runs until one can"
    )
    _, _, fire, _, reason = decide(S(phase="P2", vwc=50), P())
    assert not fire and log_words.hold(reason) == ""
    # What it does not know it says as it is.
    assert log_words.hold(Reason("something new", "new")) == "something new"
    assert log_words.shot(Reason("NEW rule 3", "new")) == ("shot", "NEW rule 3")


def test_setting_names_are_the_dashboards():
    short = dict(re.findall(r'\n  (\w+): \{\n    label: "[^"]+",\n    short: "([^"]+)"', WORDS))
    assert len(short) >= 20, "setting-words.ts no longer reads as this test expects"
    assert log_words.SETTING_NAMES == short
    ec = dict(re.findall(r'\n  "(\d)": \{\n    label: "[^"]+",\n    short: "([^"]+)"', WORDS))
    assert set(ec) == {"0", "1", "2"}
    for phase, name in ec.items():
        assert log_words.setting_name(f"ec_target_p{phase}") == name
        assert log_words.setting_name(f"ec_target_veg_p{phase}") == f"{name} (Veg)"
    dryback = re.search(r"const DRYBACK_WORDS: SettingWords = \{\n  label: \"[^\"]+\",\n  short: \"([^\"]+)\"", WORDS)
    assert log_words.setting_name("dryback_target") == dryback[1]
    assert log_words.setting_name("generative_dryback_target") == f"{dryback[1]} (Gen)"
    assert log_words.setting_name("maximum_shot_duration") == "Longest shot"
    assert log_words.setting_name("some_new_knob") == "Some new knob"


def test_a_change_is_one_sentence_as_the_dashboard_says_it():
    assert log_words.change("Maximum P1 shots", "", 6, 10, "Sam") == "Sam raised Maximum P1 shots to 10 (was 6)"
    assert log_words.change("Maintenance trigger", "%", 71.3, 63.3, "Auto setpoints") == (
        "Auto setpoints lowered Maintenance trigger to 63.3% (was 71.3%)"
    )
    assert log_words.change("Maximum EC", "mS/cm", 8.5, 9, None) == "Maximum EC raised to 9 mS/cm (was 8.5 mS/cm)"
    assert log_words.amount(12.345, "min") == "12.35 min"


def test_who_from_the_logbook():
    people = {"u1": "Sam"}
    entry = {"state": "10.0", "context_user_id": "u1"}
    assert log_words.who([entry], 10, people) == "Sam"
    assert log_words.who([{**entry, "context_user_id": "supervisor"}], 10, people) is None
    automation = {"state": "10", "context_event_type": "automation_triggered", "context_name": "Tweak"}
    assert log_words.who([automation], 10, people) == 'Automation "Tweak"'
    assert log_words.who([{"state": "10", "context_event_type": "script_started"}], 10, people) == "A script"
    # The newest entry to that value; another value, or no state, is another change.
    assert log_words.who([{**entry, "context_user_id": "u2"}, entry], 10, people) == "Sam"
    assert log_words.who([{"state": "9", "context_user_id": "u1"}, {"message": "x"}], 10, people) is None


# ---------------------------------------------------------------- the controller's own lines
class _Clock(datetime):
    """The controller's wall clock, pinned in local time (and in UTC for sensor freshness)."""

    current = None

    @classmethod
    def now(cls, tz=None):
        return cls.current if tz is None else cls.current.astimezone(tz)


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    _Clock.current = _Clock(2026, 9, 19, 14, 0)  # lights are 10:00-22:00 in the rig
    monkeypatch.setattr(controller, "datetime", _Clock)
    seconds = {"now": 0.0}
    monkeypatch.setattr(controller.time, "monotonic", lambda: seconds["now"])
    monkeypatch.setattr(controller.time, "sleep", lambda dt: seconds.__setitem__("now", seconds["now"] + dt))


class _Reply:
    def __init__(self, payload):
        self.status_code, self._payload = 200, payload

    def json(self):
        return self._payload


def _named_room(monkeypatch, logbook):
    """A named room, GR2, its zone 1 named Bench 1, disarmed (no shot runs), reading 47 %; the
    logbook's entries are `logbook`."""
    states = {
        "sensor.crop_steering_engine_config": (
            "ok",
            _desc(enable_flag="input_boolean.kill", room_name="GR2", zone_names={"1": "Bench 1"}),
        ),
        "input_boolean.kill": ("off", {}),
        "switch.crop_steering_zone_1_enabled": ("on", {}),
        "number.crop_steering_zone_1_p1_maximum_shots": ("6", {}),
        "person.sam": ("home", {"user_id": "u1", "friendly_name": "Sam"}),
    }
    c, fake = _build({"num_zones": 1, "enable_flag": "input_boolean.kill"}, states=states)
    fake.set_state(
        "sensor.crop_steering_vwc_zone_1",
        "47",
        {"unit_of_measurement": "%"},
        last_updated=_Clock.now(timezone.utc).isoformat(),
    )
    asked = []

    def get(url, **kwargs):
        asked.append((url, kwargs.get("params")))
        if "/logbook/" in url:
            return _Reply(logbook)
        raise ConnectionError("no network in tests")

    monkeypatch.setattr(controller._S, "get", get)
    return c, fake, asked


def test_every_line_is_dated_and_each_zone_says_its_readings_each_minute(monkeypatch, capsys):
    c, fake, _ = _named_room(monkeypatch, [])
    c.rooms[0].state[1].update(phase="P2", last_daily_reset=_Clock.now().date())
    c.loop_once(_Clock.now())
    lines = capsys.readouterr().out.splitlines()
    assert lines and all(re.match(STAMP + " ", line) for line in lines), lines
    zone = [line for line in lines if " GR2 · Bench 1 (Z1) · P2 · " in line]
    assert zone, lines
    assert re.fullmatch(STAMP + r" GR2 · Bench 1 \(Z1\) · P2 · VWC 47\.0% · EC — · 0\.0 L today · .+", zone[-1])


def test_a_setting_change_is_logged_with_who_made_it(monkeypatch, capsys):
    entity = "number.crop_steering_zone_1_p1_maximum_shots"
    c, fake, asked = _named_room(
        monkeypatch, [{"entity_id": entity, "state": "10.0", "context_user_id": "u1"}]
    )
    c.rooms[0].state[1].update(phase="P2", last_daily_reset=_Clock.now().date())
    c.loop_once(_Clock.now())  # the first read only notes it
    assert "Maximum P1 shots" not in capsys.readouterr().out
    fake.set_state(entity, "10")
    c.loop_once(_Clock.now())
    said = [line for line in capsys.readouterr().out.splitlines() if "Maximum P1 shots" in line]
    assert said == ["2026-09-19 14:00:00 GR2 · Bench 1 (Z1) · Sam raised Maximum P1 shots to 10 (was 6)"]
    url, params = next(item for item in asked if "/logbook/" in item[0])
    assert params["entity"] == entity
    # Said once: the next read has nothing new.
    c.loop_once(_Clock.now())
    assert "Maximum P1 shots" not in capsys.readouterr().out
