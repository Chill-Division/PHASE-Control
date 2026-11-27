"""In a room whose one valve waters every zone, each zone dries back from its own peak.

GT1, 27 Nov 2026: GT1-AT peaked at 99.4% (its probe at the top of its scale) and GT1-BP at 86.4%. The
room's peak, made one by its moisture method (Lowest), was 86.4%, so a 30% dryback held both zones to
one 60.5% line. The owner: "if we're setting a dryback target per-zone, that should be the zones
dryback, not the whole room". Two zones peaking at 80% and 100% with a 40% dryback hold at 48% and
60%, and the first zone to reach its own line waters them all: neither dries back further than asked.
The morning's P0 dryback the same: the ramp starts once the first zone has dried its amount from its
own lights-on reading.
"""
import controller
from test_one_valve_room import ZONES, Clock, _room, gone, opened, probe

VALVE = "switch.fertigation"


def _night(monkeypatch, dryback, peaks, method="Lowest"):
    """The room at 23:00, lights off since 22:00, in P3, each zone's own peak of the day `peaks`."""
    c, fake, room = _room(monkeypatch)
    Clock.instant = Clock(2026, 10, 22, 23, 0)
    fake.set_state("select.crop_steering_zone_1_vwc_method", method)
    for zone in ZONES:
        for mode in ("vegetative", "generative"):
            fake.set_state(f"number.crop_steering_zone_{zone}_{mode}_dryback_target", str(dryback))
        room.state[zone].update(phase="P3", last_phase_change=Clock(2026, 10, 22, 22, 0),
                                own_peak=peaks[zone - 1])
    room._was_lights_on = False
    return c, fake, room


def _readings(fake, *values):
    for zone, vwc in zip(ZONES, values):
        if vwc is None:
            gone(fake, zone)
        else:
            probe(fake, zone, vwc)


def _waiting(fake, zone):
    return fake.sets[f"sensor.crop_steering_zone_{zone}_waiting_for_app"][1]


def test_gt1_a_zone_is_held_at_its_own_line_though_the_room_reads_above_the_rooms(monkeypatch, capsys):
    c, fake, room = _night(monkeypatch, 30, (99.4, 86.4, 86.4))
    _readings(fake, 70.2, 62.0, 63.0)  # GT1-AT 29.4% down from its 99.4%, the others less
    c._loop_room(room, Clock.now())
    assert VALVE not in opened(fake)
    hold = next(item for item in _waiting(fake, 1)["conditions"] if item["rule"] == "p3_hold")
    assert (hold["value"], hold["now"], hold["peak"], hold["zone"], hold["zone_name"]) == (69.58, 70.2, 99.4, 1, "Zone 1")
    said = capsys.readouterr().out
    assert ("next: shot when Zone 1's VWC < 69.58% (now 70.2%), the 30% dryback from its own 99.4% peak"
            in said)
    # GT1-AT under its own 69.6% line: the room is watered, though its Lowest reading, 62%, is over
    # the 60.5% one line from the room's 86.4% peak would have been.
    _readings(fake, 69.4, 62.0, 63.0)
    c._loop_room(room, Clock.now())
    assert VALVE in opened(fake)
    shot = [line for line in capsys.readouterr().out.splitlines() if "dryback hold shot" in line]
    assert len(shot) == 1 and shot[0].endswith(
        ": Zone 1 at 69.4%, under 69.6%, the 30% P3 dryback from its own 99.4% peak"), shot


def test_the_owners_example_the_first_zone_to_reach_its_own_line_waters_both(monkeypatch):
    # 40% from 80% is 48%, from 100% is 60%. The 100% zone at 59% is under its line, the 80% zone at
    # 55% over its own: the room is watered. One line from the room's 80% peak, 48%, against the room's
    # Lowest reading, 55%, would have waited.
    c, fake, room = _night(monkeypatch, 40, (80.0, 100.0, 100.0))
    _readings(fake, 55.0, 59.0, None)
    c._loop_room(room, Clock.now())
    assert VALVE in opened(fake)


def test_each_zone_publishes_its_own_peak_of_the_day(monkeypatch):
    c, fake, room = _night(monkeypatch, 30, (99.4, 86.4, 88.0))
    _readings(fake, 70.2, 62.0, 63.0)
    c._loop_room(room, Clock.now())
    assert [_waiting(fake, zone)["peak"] for zone in ZONES] == [99.4, 86.4, 88.0]


def test_a_zone_out_of_the_rooms_reading_does_not_lead(monkeypatch):
    c, fake, room = _night(monkeypatch, 30, (99.4, 86.4, 86.4))
    _readings(fake, None, 62.0, 63.0)  # GT1-AT reads nothing: it would be 37.6% down at 62%
    c._loop_room(room, Clock.now())
    assert VALVE not in opened(fake)
    hold = next(item for item in _waiting(fake, 1)["conditions"] if item["rule"] == "p3_hold")
    assert (hold["zone"], hold["peak"]) == (2, 86.4)


def test_p0_ends_once_the_first_zone_has_dried_its_amount_from_its_own_lights_on_reading(monkeypatch, capsys):
    c, fake, room = _room(monkeypatch)
    Clock.instant = Clock(2026, 10, 22, 10, 30)  # lights on at 10:00
    for zone in ZONES:
        room.state[zone].update(phase="P0", last_phase_change=Clock(2026, 10, 22, 10, 0))
    _readings(fake, 70.0, 72.0, 74.0)
    c._loop_room(room, Clock.now())
    assert room.state[1]["phase"] == "P0"
    for zone, vwc in zip(ZONES, (70.0, 72.0, 74.0)):
        room.state[zone]["own_peak"] = vwc  # as the lights came on
    # Zone 2 3.6% under its own 72%: the room's average, 71.1%, is only 1.2% under its 72% peak.
    _readings(fake, 70.0, 69.4, 74.0)
    c._loop_room(room, Clock.now())
    assert room.state[1]["phase"] == "P1"
    said = capsys.readouterr().out
    assert "P0 → P1: the morning dryback reached 3.6%, first in Zone 2" in said


def test_a_zone_on_its_own_valve_dries_back_from_its_own_peak_as_before(monkeypatch):
    c, fake, room = _room(monkeypatch, plumbing="pump_valves",
                          valves={"1": "switch.v1", "2": "switch.v2", "3": "switch.v3"})
    assert c._valve_group(room) is None
    snap, _ = c._snapshot(room, 1, Clock.now(), True, False)
    assert snap is None or snap.dryback_vwc is None
    probe(fake, 1, 60.0)
    room.state[1]["peak"] = 80.0
    snap, _ = c._snapshot(room, 1, Clock.now(), True, False)
    assert (snap.vwc, snap.peak_vwc, snap.dryback_vwc, snap.dryback_zone) == (60.0, 80.0, None, None)
    assert snap.dryback_pct == 25.0
    assert controller.log_words.transition("P0 dryback done 3.1%") == "the morning dryback reached 3.1%"


def test_the_log_names_the_zone_or_says_its_number_without_a_name():
    words = controller.log_words
    assert words.transition("P0 dryback done 3.6% Z2", {2: "GT1-BP"}) == (
        "the morning dryback reached 3.6%, first in GT1-BP")
    assert words.transition("P0 dryback done 3.6% Z2") == "the morning dryback reached 3.6%, first in zone 2"
    reason = controller.Reason("P3 hold dryback VWC 69.4<69.6 (30% of peak 99.4) Z1", "p3_hold")
    assert words.shot(reason, {1: "GT1-AT"}) == (
        "dryback hold shot", "GT1-AT at 69.4%, under 69.6%, the 30% P3 dryback from its own 99.4% peak")
    assert words.hold(controller.Reason("P0 dryback done 3.6% Z2 | P1 ramp VWC 60<83", "p1_ramp")) == (
        "P1 ramp VWC 60<83")  # the transition, said on its own line, is no hold


def test_the_next_line_says_the_nearest_level_and_whose_reading_as_the_dashboard_does():
    # frontend/src/lib/waiting-for.test.ts says the same, word for word.
    at = Clock(2026, 9, 27, 7, 36)
    p0 = [
        {"rule": "p0_timeout", "to": "P1", "in_min": 30},
        {"rule": "p0_bypass", "to": "P1", "metric": "vwc", "op": "<=", "value": 61, "now": 66.4},
        {"rule": "p0_dryback", "to": "P1", "metric": "vwc", "op": "<=", "value": 69.84, "now": 70.5,
         "zone": 2, "zone_name": "GT1-BP"},
    ]
    assert controller.next_text(p0, at) == "P1 by 08:06, or sooner at GT1-BP's VWC ≤ 69.84% (now 70.5%)"
    one_reading = [
        {"rule": "p0_timeout", "to": "P1", "in_min": 30},
        {"rule": "p0_bypass", "to": "P1", "metric": "vwc", "op": "<=", "value": 70, "now": 84.1},
        {"rule": "p0_dryback", "to": "P1", "metric": "vwc", "op": "<=", "value": 42.9, "now": 84.1},
    ]
    assert controller.next_text(one_reading, at) == "P1 by 08:06, or sooner at VWC ≤ 70% (now 84.1%)"
