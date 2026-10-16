"""P3 holds the overnight dryback at its target, in a real Home Assistant with the real controller.

P3 used to water only below the rescue level, so a night that dried faster than the day went on past
the dryback target to the rescue level. Now a zone that dries to the day's peak less its P3 dryback
target gets a shot the size of its rescue shot. Everything it uses is the room's own: the steering
mode's dryback target, the rescue shot size and P2's time between shots, read from the integration's
numbers, and what it publishes (the zone's next condition and its label) lands in Home Assistant.
"""

from datetime import datetime

from conftest import switch_calls
from test_real_flow import VALVE
from test_setup_entry import _install

KILL = "switch.crop_steering_engine_enabled"
ARMED = (
    KILL,
    "switch.crop_steering_zone_1_enabled",
)
WAITING = "sensor.crop_steering_zone_1_waiting_for_app"
STATUS = "sensor.crop_steering_zone_1_status_app"


async def _set(hass, entity_id, value):
    await hass.services.async_call(
        "number", "set_value", {"entity_id": entity_id, "value": value}, blocking=True
    )


async def _night(hass):
    """Lights off around now: the probe's reading is only fresh on the real clock."""
    now = datetime.now()
    await _set(hass, "number.crop_steering_lights_on_hour", (now.hour + 4) % 24)
    await _set(hass, "number.crop_steering_lights_off_hour", (now.hour - 8) % 24)


async def test_a_zone_dried_to_its_dryback_target_overnight_gets_a_rescue_sized_shot(
    hass, controller_for
):
    await _install(hass)  # the seeded probe reads 41%
    await _night(hass)
    for mode in ("vegetative", "generative"):  # whichever mode the zone steers in
        await _set(hass, f"number.crop_steering_zone_1_{mode}_dryback_target", 30)
    c, fake, _clock = controller_for({"enable_flag": KILL})
    room = c.rooms[0]
    for switch in ARMED:
        fake.set_state(switch, "on")
    c.loop_once(datetime.now())
    # Tonight's peak was 70%: a 30% dryback ends at 49%, and the probe reads 41%, above the rescue level.
    room.state[1].update(phase="P3", peak=70.0, last_shot=None)
    now = datetime.now()
    snap, p = c._snapshot(room, 1, now, False, False)
    assert (p.dryback_target, p.p3_emergency_floor, snap.vwc) == (30, 40, 41)
    assert p.p3_emergency_shot == float(hass.states.get("number.crop_steering_zone_1_p3_emergency_shot_size").state)

    fake.calls.clear()
    c.loop_once(now)
    assert switch_calls(fake) == [("turn_on", VALVE), ("turn_off", VALVE)]
    assert room.state[1]["shots"] == 1
    for entity_id, (state, attributes) in fake.sets.items():  # its REST writes, into HA
        hass.states.async_set(entity_id, state, attributes)
    await hass.async_block_till_done()
    assert hass.states.get(STATUS).state == "Holding dryback"
    conditions = {item["rule"]: item for item in hass.states.get(WAITING).attributes["conditions"]}
    assert (conditions["p3_hold"]["value"], conditions["p3_hold"]["dryback"]) == (49.0, 30)
    assert conditions["p3_emergency"]["value"] == 40


async def test_a_zone_above_its_dryback_target_is_left_to_dry(hass, controller_for):
    await _install(hass)
    await _night(hass)
    c, fake, _clock = controller_for({"enable_flag": KILL})
    room = c.rooms[0]
    for switch in ARMED:
        fake.set_state(switch, "on")
    c.loop_once(datetime.now())
    # From a 55% peak the room's own dryback target (50% vegetative, 40% generative, unless changed)
    # ends at 27.5% or 33%, both under the probe's 41%.
    room.state[1].update(phase="P3", peak=55.0, last_shot=None)
    fake.calls.clear()
    c.loop_once(datetime.now())
    assert switch_calls(fake) == []
