"""A room whose one valve, after the pump, waters every zone at once ("a pump, then one valve for all
the zones").

Owner, 2026-10-22: three zones and no valve each, only the main pump and a fertigation valve that
waters all three. The zones keep their own probes and readings but share one phase, one set of
targets and every shot: the controller decides once, on all their readings together, and counts the
one shot on every zone. Two zones on one valve without that were watered once for each zone that
wanted water, every zone getting that many times the water while each counted one shot.
"""
from datetime import date, datetime, timedelta, timezone

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


def still(fake, zone, vwc, minutes):
    """A zone whose moisture has read `vwc` for `minutes`, its EC as fresh as ever."""
    probe(fake, zone, vwc)
    stamp = (Clock.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    fake.set_state(f"sensor.crop_steering_vwc_zone_{zone}", str(vwc), last_updated=stamp)


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


def test_a_zone_whose_moisture_has_stopped_changing_stays_in_the_rooms_reading(monkeypatch):
    # GR1, 30 Oct 2026: on a quiet night its probes held still for up to 80 minutes, each left the
    # room's reading after 20, and the room's moisture jumped to the others'.
    c, fake, room = _room(monkeypatch)
    group = c._valve_group(room)
    probe(fake, 1, 50)
    still(fake, 2, 44, minutes=80)
    probe(fake, 3, 62)
    vwc, _ec, own, kept = c._group_readings(room, group)
    assert (vwc, own[2][0], kept) == (52, 44, {2})  # 56 without it
    fake.set_state("select.crop_steering_zone_1_vwc_method", "Lowest")
    c._loop_room(room, Clock.now())
    assert opened(fake) == [PUMP, VALVE]  # the room reads its 44 %, under the 45 % trigger
    still(fake, 2, 44, minutes=121)  # two hours the same: out, as a probe that can't be read
    vwc, _ec, own, kept = c._group_readings(room, group)
    assert (vwc, own[2][0], kept) == (50, None, set())


@pytest.mark.parametrize("reading", [100, 41])
def test_a_still_100_or_one_under_the_rescue_level_leaves_after_20_minutes(monkeypatch, reading):
    """100% is the top of the scale, which a probe sitting in water reads; under the rescue level a
    reading that never moves would fire rescue shots, which no daily limit stops."""
    c, fake, room = _room(monkeypatch)
    fake.set_state("number.crop_steering_p3_emergency_vwc_threshold", "42")
    group = c._valve_group(room)
    probe(fake, 1, 50)
    probe(fake, 3, 62)
    still(fake, 2, reading, minutes=19)
    assert c._group_readings(room, group)[2][2][0] == reading  # changed 19 minutes ago: in
    still(fake, 2, reading, minutes=21)
    vwc, _ec, own, kept = c._group_readings(room, group)
    assert (vwc, own[2][0], kept) == (56, None, set())


def test_a_still_zone_is_said_when_it_would_have_been_out_as_long(monkeypatch):
    monkeypatch.setattr(controller, "BLIND_GRACE_MIN", 0)
    c, fake, room = _room(monkeypatch)
    probe(fake, 1, 50)
    still(fake, 2, 56, minutes=40)
    still(fake, 3, 100, minutes=40)

    def said(zone):
        return [d["message"] for dom, svc, d in fake.calls if (dom, svc) == ("persistent_notification", "create")
                and d["notification_id"].endswith(f"blind_default_z{zone}")]

    pub = c._loop_room(room, Clock.now())
    assert pub[2]["vwc"] == 56 and pub[3]["vwc"] is None
    assert "stayed at 56% for 40 minutes" in said(2)[0]
    assert "this reading stays in the room's until it has stayed the same for 2 hours" in said(2)[0]
    assert "until it reads again they are watered on the others' readings" in said(3)[0]
    # Their EC has kept changing: each probe is probably still working.
    assert "probably still working and the moisture just steady" in said(2)[0]
    assert "100% is the top of its scale" in said(3)[0]


def test_a_still_probe_on_its_own_valve_is_out_after_20_minutes_as_before(monkeypatch):
    c, fake, room = _room(monkeypatch, plumbing="pump_valves",
                          valves={str(z): f"switch.v{z}" for z in ZONES})
    for zone in ZONES:
        probe(fake, zone, 50)
    still(fake, 2, 50, minutes=21)
    pub = c._loop_room(room, Clock.now())
    assert pub[2]["vwc"] is None and pub[2]["blind"]


def gone(fake, zone):
    fake.set_state(f"sensor.crop_steering_vwc_zone_{zone}", "unavailable")


def own_peaks(room):
    return [room.state[z]["own_peak"] for z in ZONES]


def test_the_rooms_peak_is_of_the_zones_in_its_reading(monkeypatch):
    # GT1, 3 Nov 2026: GT1-AT read 100% while GT1-LMC was out, the room's reading was GT1-AT's alone,
    # and its 100% stayed the day's peak: the night was held to a 60% line instead of about 52%.
    c, fake, room = _room(monkeypatch)
    fake.set_state("select.crop_steering_zone_1_vwc_method", "Lowest")
    for zone, vwc in zip(ZONES, (87, 86, 88)):
        probe(fake, zone, vwc)
    c._loop_room(room, Clock.now())
    assert room.state[1]["peak"] == 86 and own_peaks(room) == [87, 86, 88]
    probe(fake, 1, 100)
    gone(fake, 2)
    gone(fake, 3)
    c._loop_room(room, Clock.now())
    assert room.state[1]["peak"] == 100  # the room reads zone 1 alone
    probe(fake, 2, 86)
    probe(fake, 3, 88)
    c._loop_room(room, Clock.now())
    assert room.state[1]["peak"] == 86 and own_peaks(room) == [100, 86, 88]
    assert {room.state[z]["peak"] for z in ZONES} == {86}  # every zone says the room's


def test_a_zone_leaving_the_reading_makes_no_dryback(monkeypatch):
    # GR1, 2 Nov 2026: a zone leaving the room's average dropped it by more than the 3% P0 waits for,
    # and P0 ended early.
    c, fake, room = _room(monkeypatch)
    for zone in ZONES:
        room.state[zone].update(phase="P0", last_phase_change=Clock(2026, 10, 22, 13, 50))
    for zone, vwc in zip(ZONES, (60, 66, 72)):
        probe(fake, zone, vwc)
    c._loop_room(room, Clock.now())
    gone(fake, 3)  # the average falls from 66 to 63
    c._loop_room(room, Clock.now())
    assert room.state[1]["phase"] == "P0" and room.state[1]["peak"] == 63
    for zone, vwc in zip(ZONES, (58, 64, 70)):  # every zone two points down: 3% of the 66 peak
        probe(fake, zone, vwc)
    c._loop_room(room, Clock.now())
    assert room.state[1]["phase"] == "P1"


def test_an_upgraded_room_keeps_the_peak_it_had(monkeypatch):
    """UPGRADE IN PLACE: a state file from before each zone kept its own peak has the room's alone."""
    c, fake, room = _room(monkeypatch)
    for zone, vwc in zip(ZONES, (80, 81, 82)):
        room.state[zone].update(peak=90.0, own_peak=None)
        probe(fake, zone, vwc)
    c._loop_room(room, Clock.now())
    assert room.state[1]["peak"] == 90 and own_peaks(room) == [90, 90, 90]


def test_a_new_day_starts_each_zones_own_peak_again(monkeypatch):
    c, fake, room = _room(monkeypatch)
    for zone in ZONES:
        room.state[zone].update(phase="P3", peak=90.0, own_peak=90.0)
    for zone, vwc in zip(ZONES, (60, 61, 62)):
        probe(fake, zone, vwc)
    room._was_lights_on = False  # the lights have just come on
    c._loop_room(room, Clock.now())
    assert room.state[1]["phase"] == "P0"
    assert room.state[1]["peak"] == 61 and own_peaks(room) == [60, 61, 62]
    room.state[1].update(phase="P2", peak=90.0)
    fake.set_state("select.crop_steering_zone_2_set_phase", "P0")  # P0 picked by hand, on any zone
    c._loop_room(room, Clock.now())
    assert room.state[1]["peak"] == 61 and own_peaks(room) == [60, 61, 62]


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
