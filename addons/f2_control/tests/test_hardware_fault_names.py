"""The hardware fault (CS-301) names the switch that did not read OFF, and how.

It used to say "zone 1 valve/pump/mainline close not confirmed": the operator had to search the
history of three switches for the one that stayed on. Now the fault keeps each switch that failed
and why (still ON, unavailable, unknown, unreadable, or Home Assistant refused to switch it off),
and says so in its notification, in the zone's status and in the heartbeat the dashboard shows.
A fault saved by an older controller, with only its reason, still loads and still holds.
"""

import json

import pytest

import controller
from test_controller import _build, _desc

KILL = "input_boolean.kill"
VALVE = "switch.zone1_valve"
PUMP = "switch.pump"
FLAGS = {
    KILL: ("on", {}),
    "switch.crop_steering_zone_1_enabled": ("on", {}),
}


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    """Shots run against time.monotonic/sleep: fake both so a fired shot costs no real time."""
    now = {"seconds": 0.0}
    monkeypatch.setattr(controller.time, "monotonic", lambda: now["seconds"])
    monkeypatch.setattr(controller.time, "sleep", lambda dt: now.__setitem__("seconds", now["seconds"] + dt))
    return now


def _room():
    states = {
        "sensor.crop_steering_engine_config": (
            "ok", _desc(pump=PUMP, mainline=None, valves={"1": VALVE}, enable_flag=KILL)),
        VALVE: ("off", {"friendly_name": "Zone 1 valve"}),
        PUMP: ("off", {"friendly_name": "Pump"}),
        **FLAGS,
    }
    return _build({"num_zones": 1, "enable_flag": KILL}, states=states)


def _stuck(monkeypatch, fake, entity, *, refuse=False, state=None):
    """`entity` will not switch off: Home Assistant refuses, or accepts and it stays as it is."""
    real = controller.ha_call

    def call(domain, service, **data):
        if service == "turn_off" and data.get("entity_id") == entity:
            fake.calls.append((domain, service, data))
            if state is not None:
                fake.set_state(entity, state, fake.states[entity][1] if isinstance(fake.states[entity], tuple) else {})
            return not refuse
        return real(domain, service, **data)

    monkeypatch.setattr(controller, "ha_call", call)


def _notification(fake):
    (data,) = [
        d for dom, svc, d in fake.calls
        if (dom, svc) == ("persistent_notification", "create") and "hardware" in d.get("title", "")
    ]
    return data["message"]


def test_a_pump_left_on_is_named_in_the_notification_the_zone_and_the_heartbeat(monkeypatch):
    c, fake = _room()
    _stuck(monkeypatch, fake, PUMP)
    room = c.rooms[0]
    c._execute_shot(room, 1, 6, 2.0)
    assert room.hardware_fault["switches"] == [
        {"entity_id": PUMP, "problem": "on", "name": "Pump"}
    ]
    said = "zone 1 shot end: Pump (switch.pump) still read ON 6 s after it was switched off"
    message = _notification(fake)
    assert message.startswith(said + ".")
    assert "Code CS-301" in message and KILL in message
    assert c._blocked(room, 1) == f"hardware fault (CS-301): {said}"
    assert c._hardware_fault_block(room) == f"hardware fault (CS-301): {said}"
    # The internal room name and the old instructions are gone from what the dashboard shows.
    assert "default" not in c._hardware_fault_block(room)
    assert "re-arm" not in c._hardware_fault_block(room)


def test_a_valve_home_assistant_refuses_to_switch_off(monkeypatch):
    c, fake = _room()
    _stuck(monkeypatch, fake, VALVE, refuse=True)
    room = c.rooms[0]
    c._execute_shot(room, 1, 6, 2.0)
    assert room.hardware_fault["switches"][0]["problem"] == "refused"
    assert (
        "Zone 1 valve (switch.zone1_valve) was not switched off: Home Assistant returned an error"
        in _notification(fake)
    )


def test_a_valve_that_drops_off_the_network_reads_unavailable(monkeypatch):
    c, fake = _room()
    _stuck(monkeypatch, fake, VALVE, state="unavailable")
    room = c.rooms[0]
    c._execute_shot(room, 1, 6, 2.0)
    assert [s["problem"] for s in room.hardware_fault["switches"]] == ["unavailable"]
    assert "read unavailable: Home Assistant could not reach it" in c._hardware_fault_block(room)


def test_every_switch_reading_off_by_the_time_it_is_looked_at_was_late():
    # The read-back gave up on it first: the hold stands, and says why.
    c, _fake = _room()
    failures = c._close_failures([VALVE, PUMP])
    assert failures == [{"entity_id": None, "problem": "late"}]
    c._latch_hardware_fault(c.rooms[0], "zone 1 shot end", failures)
    assert c._hardware_fault_block(c.rooms[0]).endswith(
        "zone 1 shot end: a pump or valve reported OFF only after the 6 s check"
    )


def test_a_fault_saved_by_an_older_controller_loads_and_still_holds():
    c, _fake = _room()
    room = c.rooms[0]
    old = {"reason": "zone 1 valve/pump/mainline close not confirmed", "entities": [PUMP, VALVE]}
    with open(c._state_path, "w", encoding="utf-8") as f:
        json.dump({room.slug: {"_hardware_fault": old}}, f)
    c._load_state()
    assert room.hardware_fault == {**old, "switches": []}
    assert c._hardware_fault_block(room) == (
        "hardware fault (CS-301): zone 1 valve/pump/mainline close not confirmed"
    )
    # Saved again, it gains the (empty) list and loads the same.
    c._save_state()
    c._load_state()
    assert room.hardware_fault["switches"] == []


def test_every_zone_of_a_held_room_says_so_whether_it_wants_water_or_not():
    """A zone that wanted no water this pass used to read its phase ("Optimal" in P2) while the
    fault held the room, and nothing could water it."""
    from datetime import datetime

    from test_zone_count import KILL as ROOM_KILL, _room as _two_zones

    states = _two_zones(2)
    states[ROOM_KILL] = ("on", {})
    states["sensor.crop_steering_vwc_zone_2"] = ("75", {"unit_of_measurement": "%"})  # wet: wants nothing
    c, fake = _build({"num_zones": 2, "enable_flag": ROOM_KILL}, states=states)
    c._latch_hardware_fault(
        c.rooms[0], "zone 1 shot end", [{"entity_id": "switch.valve_1", "problem": "on"}]
    )
    c.loop_once(datetime(2026, 10, 10, 14, 0, 0))
    labels = {z: fake.sets[f"sensor.crop_steering_zone_{z}_status_app"][0] for z in (1, 2)}
    assert labels == {1: "Blocked: hardware fault (CS-301)", 2: "Blocked: hardware fault (CS-301)"}
