"""A room whose probes read nothing never says its zones are in band.

GT1, 4 Nov 2026: a firmware update gave the room's probes new entity ids, so from 15:26 the zones the
room was set up with read nothing. Between its timer shots, the room's line said "Holding — all zones in
band" beside the dashboard's "sensor data unavailable", and Coming up said nothing more was expected
before lights-on, while a timer shot was due every 90 minutes.
"""
from datetime import datetime

import pytest

import controller
from test_one_valve_room import ZONES, Clock, _room, probe

DECISION = "sensor.crop_steering_current_decision"


def waiting(fake, zone):
    return fake.sets[f"sensor.crop_steering_zone_{zone}_waiting_for_app"]


@pytest.mark.usefixtures("no_blind_grace")
def test_a_room_with_no_reading_says_so_and_when_its_next_timer_shot_is(monkeypatch):
    c, fake, room = _room(monkeypatch)  # 14:00, its probes reading nothing
    for zone in ZONES:
        room.state[zone]["last_shot"] = Clock(2026, 10, 22, 13, 30)  # 30 minutes ago: 60 to go
    c._publish_status(room, c._loop_room(room, Clock.now()), Clock.now())
    state, attrs = fake.sets[DECISION]
    assert "in band" not in state
    words = "no moisture reading: watered on a timer, the next shot at 15:00, then one every 90 min"
    assert state == f"Z1 P2 {words}"
    assert attrs["blind"] == [f"Z{zone} P2 {words}" for zone in ZONES]
    assert attrs["fired"] == attrs["blocked"] == []
    for zone in ZONES:  # what each zone waits for: its next timer shot, in its phase
        phase, published = waiting(fake, zone)
        assert phase == "P2"
        assert published["conditions"] == [
            {"rule": "blind_timer", "shot": True, "to": None, "in_min": 60.0, "every_min": 90}
        ]


def test_one_just_gone_waits_out_the_grace_first(monkeypatch):
    c, fake, room = _room(monkeypatch)  # the last shot two hours ago: the timer's is due at once...
    c._publish_status(room, c._loop_room(room, Clock.now()), Clock.now())
    phase, published = waiting(fake, 1)  # ...once the probes have been out for the grace
    assert published["conditions"][0]["in_min"] == controller.BLIND_GRACE_MIN
    assert fake.sets[DECISION][0].startswith("Z1 P2 no moisture reading: watered on a timer, the next shot at 14:15")


@pytest.mark.usefixtures("no_blind_grace")
def test_a_timer_shot_due_is_watered_and_said_as_before(monkeypatch):
    c, fake, room = _room(monkeypatch)  # the last shot two hours ago
    c._publish_status(room, c._loop_room(room, Clock.now()), Clock.now())
    state, attrs = fake.sets[DECISION]
    assert state == "Z1 P2 FALLBACK schedule (no live probe)" and attrs["blind"] == []


@pytest.mark.usefixtures("no_blind_grace")
def test_a_zone_watered_with_another_zones_shots_says_whose(monkeypatch):
    c, fake, room = _room(monkeypatch, plumbing=None, valves={str(z): f"switch.v{z}" for z in ZONES})
    for zone in (1, 3):  # each zone its own valve, zone 2 reading nothing; none due a shot
        probe(fake, zone, 60)
    c._publish_status(room, c._loop_room(room, Clock.now()), Clock.now())
    state, attrs = fake.sets[DECISION]
    assert state in (f"Z2 P2 no moisture reading: watered with Z{zone}'s shots" for zone in (1, 3))
    assert attrs["blind"] == [state]
    assert waiting(fake, 2)[1]["conditions"] == []  # no timer of its own


def test_a_room_whose_zones_all_read_is_in_band_as_before(monkeypatch):
    c, fake, room = _room(monkeypatch)
    for zone in ZONES:
        probe(fake, zone, 60)
    c._publish_status(room, c._loop_room(room, Clock.now()), Clock.now())
    assert fake.sets[DECISION] == ("Holding — all zones in band", {"fired": [], "blocked": [], "blind": []})


def test_the_vitals_say_the_next_timer_shot():
    at = datetime(2026, 11, 4, 22, 4)
    timer = {"rule": "blind_timer", "shot": True, "to": None, "every_min": 90}
    assert controller.next_text([{**timer, "in_min": 90.0}], at) == "timer shot at 23:34, then one every 90 min"
    assert controller.next_text([{**timer, "in_min": 0.0}], at) == "timer shot due, then one every 90 min"
