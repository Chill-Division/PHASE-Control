"""Every P3 shot, rescue or dryback hold, waits the room's "P3 Time Between Shots" after the last
shot, in a real Home Assistant with the real controller.

Seen live on GR2: three hold shots a few minutes apart, each before the last had reached the probe,
lifted the zone about 6 points past its hold, and a rescue waited for nothing at all, so a zone
still reading under the rescue level after one got another every minute. The setting is a number,
room-wide and per zone like P2's, 10 minutes unless changed. An install upgraded from before it
has it at 10, and a controller whose integration is older than it uses 10 without holding the room
for a missing setting.
"""

from datetime import datetime, timedelta

from crop_steering_engine import decide
from test_setup_entry import _install
from test_upgrade_in_place import _upgrade

ROOM = "number.crop_steering_p3_time_between_shots"
ZONE = "number.crop_steering_zone_1_p3_time_between_shots"
RESCUE_LEVEL = "number.crop_steering_zone_1_p3_emergency_vwc_threshold"
WAITING = "sensor.crop_steering_zone_1_waiting_for_app"


async def _set(hass, entity_id, value):
    await hass.services.async_call(
        "number", "set_value", {"entity_id": entity_id, "value": value}, blocking=True
    )


async def _night(hass):
    """Lights off around now, so the zone is in P3 whenever this runs."""
    now = datetime.now()
    await _set(hass, "number.crop_steering_lights_on_hour", (now.hour + 4) % 24)
    await _set(hass, "number.crop_steering_lights_off_hour", (now.hour - 8) % 24)


async def test_a_new_room_spaces_its_p3_shots_ten_minutes_apart(hass):
    await _install(hass)
    for entity_id in (ROOM, ZONE):
        state = hass.states.get(entity_id)
        assert float(state.state) == 10
        assert (state.attributes["min"], state.attributes["max"]) == (0, 60)
        assert state.attributes["unit_of_measurement"] == "min"


async def test_an_upgraded_room_has_it_at_ten_minutes(hass):
    await _upgrade(hass, "entry_2_17_wizard.json")
    assert float(hass.states.get(ROOM).state) == 10
    assert float(hass.states.get(ZONE).state) == 10


async def test_the_controller_spaces_a_rescue_by_the_zones_own_time_and_says_when(
    hass, controller_for
):
    await _install(hass)
    await _night(hass)
    await _set(hass, RESCUE_LEVEL, 65)  # over the probe's reading: a rescue is wanted
    await _set(hass, ZONE, 12)  # the zone's own value wins over the room's 10
    c, fake, _clock = controller_for({})
    room = c.rooms[0]
    c.loop_once(datetime.now())  # the first pass starts the grow-day
    now = datetime.now()
    room.state[1].update(phase="P3", last_shot=now - timedelta(minutes=1))
    snap, p = c._snapshot(room, 1, now, False, False)
    assert p.p3_time_between_min == 12
    assert snap.vwc < p.p3_emergency_floor  # a rescue is wanted...
    assert decide(snap, p)[2] is False  # ...and waits
    later = snap.__class__(**{**snap.__dict__, "minutes_since_shot": 12})
    assert decide(later, p)[4].kind == "p3_emergency"

    c.loop_once(now)
    for entity_id, (state, attributes) in fake.sets.items():  # its REST writes, into HA
        hass.states.async_set(entity_id, state, attributes)
    await hass.async_block_till_done()
    conditions = {c["rule"]: c for c in hass.states.get(WAITING).attributes["conditions"]}
    assert 10.5 <= conditions["p3_emergency"]["in_min"] <= 11.0


async def test_an_integration_without_the_setting_leaves_the_controller_at_ten_minutes(
    hass, controller_for
):
    await _install(hass)
    for entity_id in (ROOM, ZONE):  # as an integration from before this setting has none
        hass.states.async_remove(entity_id)
    c, _fake, _clock = controller_for({})
    room = c.rooms[0]
    assert c._params(room, 1).p3_time_between_min == 10
    missing = getattr(room, "_settings_missing", set())
    assert ROOM not in missing and ROOM not in c._defaulted_this_loop
