"""A zone's moisture that has stopped changing is still steered by for up to STILL_KEEP_MIN (2 hours),
on a valve of its own as in a one-valve room.

GR2, 25 Nov 2026, early veg, one zone on its own valve: on a quiet night its moisture held at 69.8% for
36 minutes, its EC still moving. At 20 minutes the controller took the probe for dead (CS-101), and 15
minutes later its timer watered the zone, 3.8 L at 04:29, back up to its peak 2.5 hours before
lights-on. In the 3.5 days before, it had taken that probe for dead 7 more times, each time saved by the
reading moving within the 15 minutes. Three still readings count as gone after 20 minutes, as before:
100% (a probe sitting in water), one under the rescue level, and one that hasn't moved in the 20
minutes since a shot (the zone's own reading decides its shots, so a probe stuck low would keep asking
for water).
"""
from datetime import datetime, timedelta, timezone

import pytest

import controller
from test_room_status import _room

VWC = "sensor.crop_steering_vwc_zone_1"
EC = "sensor.crop_steering_ec_zone_1"
VALVES = ["switch.p", "switch.m", "switch.v1"]  # one shot: pump, main line, the zone's valve


class _Clock(datetime):
    """The controller's wall clock, pinned, in local time and (for sensor freshness) in UTC."""

    current = None

    @classmethod
    def now(cls, tz=None):
        return cls.current if tz is None else cls.current.astimezone(tz)


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    _Clock.current = _Clock(2026, 9, 25, 14, 0)  # the rig's lights are 10:00-22:00
    monkeypatch.setattr(controller, "datetime", _Clock)
    seconds = {"now": 0.0}
    monkeypatch.setattr(controller.time, "monotonic", lambda: seconds["now"])
    monkeypatch.setattr(controller.time, "sleep", lambda dt: seconds.__setitem__("now", seconds["now"] + dt))


def _read(fake, vwc, still_min=0):
    """The zone's moisture, the same for `still_min` minutes, and an EC that has just changed."""
    stamp = _Clock.now(timezone.utc)
    fake.set_state(VWC, str(vwc), {"unit_of_measurement": "%"},
                   last_updated=(stamp - timedelta(minutes=still_min)).isoformat())
    fake.set_state(EC, "3", {"unit_of_measurement": "mS/cm"}, last_updated=stamp.isoformat())


def _later(minutes):
    _Clock.current += timedelta(minutes=minutes)


def _shots(fake):
    opened = [d["entity_id"] for dom, svc, d in fake.calls if (dom, svc) == ("switch", "turn_on")]
    assert len(opened) % 3 == 0 and all(opened[i:i + 3] == VALVES for i in range(0, len(opened), 3))
    return len(opened) // 3


def _probe_alerts(fake):
    return [d["message"] for dom, svc, d in fake.calls
            if (dom, svc) == ("persistent_notification", "create") and "blind" in str(d.get("notification_id"))]


def _zone(phase="P2", watered_ago=180):
    """An armed one-zone room on its own valve, in `phase`, last watered `watered_ago` minutes ago. Its
    top-up trigger is 45%, its rescue level 40%, and its dead-probe timer waters every 90 minutes."""
    c, fake = _room("on")
    c.rooms[0].state[1].update(phase=phase, last_daily_reset=_Clock.now().date(),
                               last_shot=_Clock.now() - timedelta(minutes=watered_ago))
    return c, fake


def _steered(c):
    return c._own_moisture(c.rooms[0], 1, _Clock.now())


def test_a_still_reading_is_steered_by_for_2_hours_then_the_timer_takes_over():
    c, fake = _zone()
    for still_min in (21, 36, 119):
        _read(fake, 60, still_min)
        c.loop_once(_Clock.now())
        assert _steered(c) == 60
    assert _shots(fake) == 0 and _probe_alerts(fake) == []
    _read(fake, 60, 121)  # two hours the same: now it is a dead probe
    c.loop_once(_Clock.now())
    assert _steered(c) is None and _shots(fake) == 0 and _probe_alerts(fake) == []  # its grace
    _later(15)
    _read(fake, 60, 136)
    c.loop_once(_Clock.now())
    assert _shots(fake) == 1  # the timer: 3 hours since the last shot
    (alert,) = _probe_alerts(fake)
    assert "stayed at 60% for 2.3 hours, but its EC has kept changing" in alert


def test_gr2_a_quiet_night_in_early_veg_gets_no_timer_shot():
    # 25 Nov 2026, 04:29, lights 07:00-20:00 there (10:00-22:00 here): 69.8% since 03:53, last watered
    # at 14:55 the day before, the overnight target far below.
    _Clock.current = _Clock(2026, 9, 26, 4, 29)
    c, fake = _room("on")
    c.rooms[0].state[1].update(phase="P3", peak=70.5, last_daily_reset=_Clock(2026, 9, 25).date(),
                               last_shot=_Clock(2026, 9, 25, 14, 55))
    for still_min in (21, 36, 90):
        _read(fake, 69.8, still_min)
        c.loop_once(_Clock.now())
        assert _steered(c) == 69.8
    assert _shots(fake) == 0 and _probe_alerts(fake) == []


@pytest.mark.parametrize("reading", [100, 39])
def test_a_still_100_or_one_under_the_rescue_level_leaves_after_20_minutes(reading):
    c, fake = _zone()
    _read(fake, reading, 19)
    assert _steered(c) == reading
    _read(fake, reading, 21)
    assert _steered(c) is None


def test_a_shot_answered_by_the_reading_is_forgotten():
    c, fake = _zone()
    room = c.rooms[0]
    room._unanswered = {1: _Clock.now() - timedelta(minutes=30)}
    _read(fake, 60, 25)  # changed 25 minutes ago, after the shot 30 minutes ago
    assert _steered(c) == 60 and room._unanswered == {}
    room._unanswered = {1: _Clock.now() - timedelta(minutes=30)}
    _read(fake, 60, 40)  # unchanged since before the shot
    assert _steered(c) is None
    room._unanswered = {1: _Clock.now() - timedelta(minutes=15)}
    _read(fake, 60, 40)  # the shot is 15 minutes old: the probe has 20 to move
    assert _steered(c) == 60


def test_a_probe_stuck_low_asks_for_water_only_until_20_minutes_after_its_first_shot():
    # Kept for 2 hours, a reading stuck under the trigger would ask for a top-up every 5 minutes,
    # each shot keeping it in, until the day's water limit.
    c, fake = _zone()
    stuck = _Clock.now(timezone.utc) - timedelta(minutes=25)  # 42%, under the 45% trigger, since 13:35
    counts = []
    for _ in range(60):
        fake.set_state(VWC, "42", {"unit_of_measurement": "%"}, last_updated=stuck.isoformat())
        fake.set_state(EC, "3", {"unit_of_measurement": "mS/cm"}, last_updated=_Clock.now(timezone.utc).isoformat())
        c.loop_once(_Clock.now())
        counts.append(_shots(fake))
        _later(1)
    first = counts.index(1)
    assert counts[first + 21] == counts[-1]  # none from 21 minutes after the first
    assert counts[-1] <= 5  # the top-ups 5 minutes apart within those 20 minutes, as before
    (alert,) = set(_probe_alerts(fake))
    assert "though the zone was watered" in alert
    assert "its dripper may be blocked or out of place" in alert
    assert "Check the probe is pushed into its cube and connected" in alert


def test_the_notification_says_the_shot_the_reading_did_not_move_for():
    c, fake = _zone()
    room = c.rooms[0]
    room._unanswered = {1: _Clock.now() - timedelta(minutes=25)}
    _read(fake, 60, 40)
    c.loop_once(_Clock.now())  # out: grace
    _later(15)
    _read(fake, 60, 55)
    c.loop_once(_Clock.now())
    (alert,) = _probe_alerts(fake)
    assert alert.startswith(
        "This zone's moisture reading has stayed at 60% for 55 minutes, though the zone was watered 40 "
        "minutes ago. A working probe moves when its zone is watered, so this one may have stopped, or "
        "its dripper may be blocked or out of place."
    )
    assert ";" not in alert.split("\n\nSensor:")[0].split("watered on a timer")[0]
