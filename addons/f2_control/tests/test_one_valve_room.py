"""A room whose one valve, after the pump, waters every zone at once ("a pump, then one valve for all
the zones").

Owner, 2026-10-22: three zones and no valve each, only the main pump and a fertigation valve that
waters all three. The zones keep their own probes and readings but share one phase, one set of
targets and every shot: the controller decides once, on all their readings together, and counts the
one shot on every zone. Two zones on one valve without that were watered once for each zone that
wanted water, every zone getting that many times the water while each counted one shot.
"""
from datetime import date, datetime, timezone

import pytest

import controller
from test_controller import _build, _desc

KILL = "input_boolean.kill"
PUMP = "switch.p"
VALVE = "switch.fertigation"
DESCRIPTOR = "sensor.crop_steering_engine_config"
ZONES = (1, 2, 3)


class Clock(datetime):
    """The controller's wall clock, pinned by the test."""

    instant = None

    @classmethod
    def now(cls, tz=None):
        return cls.instant.replace(tzinfo=tz) if tz else cls.instant


def _room(monkeypatch, plumbing="pump_one_valve", valves=None, switch_off=None):
    """Three zones, all on the one valve unless `valves` says otherwise, lights 10-22, at 14:00. With
    `switch_off`, that entity goes off while the valve is open."""
    Clock.instant = Clock(2026, 10, 22, 14, 0)
    monkeypatch.setattr(controller, "datetime", Clock)
    extra = {"plumbing": plumbing} if plumbing else {}
    states = {
        DESCRIPTOR: ("ok", _desc(pump=PUMP, mainline=None, num=3, enable_flag=KILL,
                                 valves=valves or {str(z): VALVE for z in ZONES}, **extra)),
        KILL: ("on", {}),
        **{f"switch.crop_steering_zone_{z}_enabled": ("on", {}) for z in ZONES},
        # Three identical zones: 42 plants each in 6.75 L, one 4 L/h dripper each.
        **{f"number.crop_steering_{key}": (str(value), {}) for key, value in {
            "plant_count": 42, "substrate_volume": 6.75, "drippers_per_plant": 1, "dripper_flow_rate": 4,
        }.items()},
    }
    c, fake = _build({"num_zones": 3, "enable_flag": KILL}, states=states)
    clock = {"seconds": 0.0}
    monkeypatch.setattr(controller.time, "monotonic", lambda: clock["seconds"])

    def sleep(seconds):
        clock["seconds"] += seconds
        if switch_off and fake.states[VALVE][0] == "on":  # the shot is running
            fake.set_state(switch_off, "off")

    monkeypatch.setattr(controller.time, "sleep", sleep)
    room = c.rooms[0]
    for zone in ZONES:
        room.state[zone].update(phase="P2", last_shot=Clock(2026, 10, 22, 12, 0),
                                last_daily_reset=date(2026, 10, 22), last_phase_change=Clock(2026, 10, 22, 10, 0))
    return c, fake, room


def probe(fake, zone, vwc, ec=3.0):
    stamp = Clock.now(timezone.utc).isoformat()
    fake.set_state(f"sensor.crop_steering_vwc_zone_{zone}", str(vwc), last_updated=stamp)
    fake.set_state(f"sensor.crop_steering_ec_zone_{zone}", str(ec), last_updated=stamp)


def opened(fake):
    return [d["entity_id"] for dom, svc, d in fake.calls if dom == "switch" and svc == "turn_on"]


def test_the_room_decides_once_and_its_one_shot_is_counted_on_every_zone(monkeypatch):
    c, fake, room = _room(monkeypatch)
    for zone, vwc in zip(ZONES, (40, 41, 42)):  # their average, 41, is under the 45 % top-up trigger
        probe(fake, zone, vwc)
    pub = c._loop_room(room, Clock.now())
    assert opened(fake) == [PUMP, VALVE]  # one shot, not one a zone
    assert all(pub[z]["fire"] and pub[z]["block"] is None for z in ZONES)
    water = [room.state[z]["daily_vol"] for z in ZONES]
    assert water[0] > 0 and water == [water[0]] * 3  # each zone counts the water it got
    assert [room.state[z]["shots"] for z in ZONES] == [1, 1, 1]
    assert [pub[z]["vwc"] for z in ZONES] == [40, 41, 42]  # each zone still says its own reading


def test_each_zone_counts_its_own_water_and_starts_the_grow_day_from_nothing(monkeypatch):
    # Owner, 2026-10-26: GT1, one valve for GT1-AT's 5 plants and GT1-LMC's 2, each plant one 4 L/h
    # dripper. Every pass the second zone copied the first's water today, so GT1-LMC read 2.5 times
    # GT1-AT's a plant, though every plant got the same.
    c, fake, room = _room(monkeypatch)
    for zone, plants in zip(ZONES, (5, 2, 2)):
        fake.set_state(f"number.crop_steering_zone_{zone}_plant_count", str(plants))
    for zone in ZONES:
        probe(fake, zone, 40)
    c._loop_room(room, Clock.now())  # the shot
    c._loop_room(room, Clock.now())  # the next pass, where the other zones follow the first
    water = [room.state[z]["daily_vol"] for z in ZONES]
    assert water[0] > 0
    assert water[1:] == [pytest.approx(water[0] * 2 / 5)] * 2  # the same a plant
    assert [room.state[z]["shots"] for z in ZONES] == [1, 1, 1]  # one shot, every zone's
    # The first zone starts a new grow-day: every zone counts from nothing.
    room.state[1].update(daily_vol=0.0, last_daily_reset=date(2026, 10, 23))
    c._follow_lead(room, c._valve_group(room))
    assert [room.state[z]["daily_vol"] for z in ZONES] == [0.0, 0.0, 0.0]


def test_the_zones_readings_decide_together_as_the_first_zone_reads_its_probes(monkeypatch):
    c, fake, room = _room(monkeypatch)
    for zone, vwc in zip(ZONES, (40, 60, 60)):  # one zone dry, the room on average not
        probe(fake, zone, vwc)
    c._loop_room(room, Clock.now())
    assert opened(fake) == []
    fake.set_state("select.crop_steering_zone_1_vwc_method", "Lowest")  # the driest decides
    c._loop_room(room, Clock.now())
    assert opened(fake) == [PUMP, VALVE]


def test_every_zone_takes_the_rooms_phase(monkeypatch):
    c, fake, room = _room(monkeypatch)
    for zone in ZONES:
        probe(fake, zone, 55)
    room.state[2]["phase"] = room.state[3]["phase"] = "P1"  # out of step, as before the layout
    pub = c._loop_room(room, Clock.now())
    assert {room.state[z]["phase"] for z in ZONES} == {"P2"} == {pub[z]["phase"] for z in ZONES}


def test_a_phase_picked_on_any_zone_moves_them_all(monkeypatch):
    c, fake, room = _room(monkeypatch)
    for zone in ZONES:
        probe(fake, zone, 55)
    fake.set_state("select.crop_steering_zone_3_set_phase", "P1")
    c._loop_room(room, Clock.now())
    assert {room.state[z]["phase"] for z in ZONES} == {"P1"}
    assert ("select", "select_option", {"entity_id": "select.crop_steering_zone_3_set_phase",
                                        "option": "Keep"}) in fake.calls  # asked for once


@pytest.mark.parametrize("entity, state, words", [
    ("switch.crop_steering_zone_2_enabled", "off", "Zone 2 paused"),
    ("switch.crop_steering_zone_3_manual_override", "on", "Zone 3 on manual override"),
])
def test_one_zone_paused_or_overridden_holds_the_valve_for_all(monkeypatch, entity, state, words):
    c, fake, room = _room(monkeypatch)
    fake.set_state(entity, state)
    for zone in ZONES:
        probe(fake, zone, 40)
    pub = c._loop_room(room, Clock.now())
    assert opened(fake) == []
    assert words in pub[1]["block"] and all(pub[z]["block"] == pub[1]["block"] for z in ZONES)
    assert len("Blocked: " + pub[1]["block"]) <= 80  # a zone's status, whole


def test_a_zone_switched_off_mid_shot_stops_the_shot_for_all(monkeypatch):
    c, fake, room = _room(monkeypatch, switch_off="switch.crop_steering_zone_3_enabled")
    c._execute_shot(room, 1, 10, 6)
    assert fake.states[VALVE][0] == "off" and fake.states[PUMP][0] == "off"
    stopped = [d for dom, svc, d in fake.calls
               if (dom, svc) == ("persistent_notification", "create") and "killshot" in d["notification_id"]]
    assert stopped and "Zone 3, on the same valve, was switched off" in stopped[0]["message"]
    water = [room.state[z]["daily_vol"] for z in ZONES]
    assert water[0] > 0 and water == [water[0]] * 3  # what it gave, counted on every zone


def test_a_test_shot_asked_for_on_any_zone_runs_once_for_the_room(monkeypatch):
    c, fake, room = _room(monkeypatch)
    for zone in ZONES:
        probe(fake, zone, 55)
    button = "button.crop_steering_zone_2_test_shot"
    fake.set_state(button, "2026-10-22T13:00:00")
    c._loop_room(room, Clock.now())  # the state seen first is where it stands, not a press
    fake.set_state(button, Clock.now().astimezone().isoformat())  # a press now, on the local clock
    c._loop_room(room, Clock.now())
    assert opened(fake) == [PUMP, VALVE]
    assert [room.state[z]["shots"] for z in ZONES] == [0, 0, 0]  # water, but not one of the day's shots
    assert room.state[1]["daily_vol"] > 0 and len({room.state[z]["daily_vol"] for z in ZONES}) == 1


def test_one_shot_takes_every_zones_water_from_the_reservoir(monkeypatch):
    c, _fake, room = _room(monkeypatch)
    one = 10 / 100 * 42 * 6.75  # a 10 % shot of one zone's 42 x 6.75 L
    assert c._shot_litres(room, 1, 10) == pytest.approx(3 * one)


def test_a_zone_whose_probe_cannot_be_read_is_said_and_the_others_water(monkeypatch):
    monkeypatch.setattr(controller, "BLIND_GRACE_MIN", 0)
    c, fake, room = _room(monkeypatch)
    probe(fake, 1, 40)
    probe(fake, 3, 42)
    fake.set_state("sensor.crop_steering_vwc_zone_2", "unavailable")
    pub = c._loop_room(room, Clock.now())
    assert opened(fake) == [PUMP, VALVE] and pub[2]["vwc"] is None
    said = [d for dom, svc, d in fake.calls
            if (dom, svc) == ("persistent_notification", "create") and d["notification_id"].endswith("blind_default_z2")]
    assert said and "watered on the others' readings" in said[0]["message"]


@pytest.mark.parametrize("plumbing", [None, "pump_valves"])
def test_two_zones_on_one_valve_without_the_layout_are_held_not_watered_twice(monkeypatch, plumbing):
    c, fake, room = _room(monkeypatch, plumbing=plumbing,
                          valves={"1": "switch.v1", "2": VALVE, "3": VALVE})
    reason = c._blocked(room, 2)
    assert "zones 2 and 3 are mapped to one valve" in reason and "one valve for all the zones" in reason
    c._execute_shot(room, 2, 6, 2.0)
    assert opened(fake) == []


def test_the_layout_holds_zones_mapped_to_different_valves(monkeypatch):
    c, fake, room = _room(monkeypatch, valves={"1": VALVE, "2": VALVE, "3": "switch.v3"})
    assert "mapped to different valves" in c._blocked(room, 1)
    c._execute_shot(room, 1, 6, 2.0)
    assert opened(fake) == []


def test_readings_are_made_one_as_the_integration_makes_a_zones_probes_one():
    """The controller's copy of calculations.combine_probes (it cannot import the integration)."""
    values = [50, 61, 70]
    assert [controller.combine_readings(values, m) for m in ("Average", "Median", "Lowest", "Highest")] == [
        60.33, 61, 50, 70]
    assert controller.combine_readings(values, "Unknown") == 60.33  # as the average
    assert controller.combine_readings([], "Average") is None
