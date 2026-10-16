"""System Enabled and Auto Irrigation Enabled are gone: the room's engine switch is the one switch.

Retired in 2.25.0, they were kept, hidden, and one that read off kept a room from watering: the
controller switched the engine switch off in its place (CS-208), and only Home Assistant could put
it right. The integration no longer creates them and removes both on setup. One an older
integration left behind, off, is never read: it neither holds a shot nor switches watering off.
"""
from datetime import datetime

import pytest

import controller
from test_controller import _build, _desc

KILL = "input_boolean.kill"
SYSTEM = "switch.crop_steering_system_enabled"
AUTO = "switch.crop_steering_auto_irrigation_enabled"


def _room(overrides):
    states = {
        "sensor.crop_steering_engine_config": ("ok", _desc(enable_flag=KILL)),
        KILL: ("on", {}),
        "switch.crop_steering_zone_1_enabled": ("on", {}),
    }
    states.update(overrides)
    c, fake = _build({"num_zones": 1, "enable_flag": KILL}, states=states)
    return c, fake, c.rooms[0]


@pytest.mark.parametrize("entity", [SYSTEM, AUTO])
def test_one_left_behind_off_neither_holds_a_shot_nor_switches_watering_off(entity):
    c, fake, room = _room({entity: ("off", {})})
    assert c._blocked(room, 1) is None
    fake.calls.clear()
    c.loop_once(datetime(2026, 10, 17, 12, 0))
    assert not any(svc == "turn_off" and d.get("entity_id") == KILL for _dom, svc, d in fake.calls)
    assert not any(
        dom == "persistent_notification" and "(CS-208)" in d.get("title", "")
        for dom, _svc, d in fake.calls
    )
    assert fake.states[KILL][0] == "on"


def test_nothing_is_left_that_reads_them():
    assert not hasattr(controller, "RETIRED_SWITCHES")
    assert not hasattr(controller.Controller, "_carry_retired_switches")
