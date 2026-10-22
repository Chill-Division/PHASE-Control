"""A setup change that switches nothing differently, saved and taken on with watering on.

GT4, 2026-10-19: mapping the tank's distance sensor in Rooms & hardware meant switching watering off
to save. Watering went straight back on, the controller (which looked for a change only every five
minutes, and took one on only with watering off) found it on, and held the whole room until watering
was cycled off again, while the dashboard said "Steering". Now a change that leaves every switch as
it was saves with watering on and the real controller takes it on with watering on; one that remaps
a switch still needs watering off, and is taken on within a pass of it.
"""

import json

import pytest
from homeassistant.exceptions import HomeAssistantError
from test_install_to_controller import KILL
from test_real_flow import VALVE
from test_setup_entry import _install, _save_zones

import controller


def _sync(hass, fake):
    """The controller's next read of Home Assistant, as the REST API would send it."""
    for state in hass.states.async_all():
        attributes = json.loads(json.dumps(dict(state.attributes), default=str))
        fake.set_state(state.entity_id, state.state, attributes)


async def _steering(hass):
    await hass.services.async_call("switch", "turn_on", {"entity_id": KILL}, blocking=True)
    await hass.async_block_till_done()


async def test_a_rename_saves_and_is_taken_on_with_watering_on(
    hass, controller_for, hass_admin_user
):
    await _install(hass)
    c, fake, _clock = controller_for({"enable_flag": KILL})
    room = c.rooms[0]
    assert room.setup_revision == 1 and room._setup_pending is None
    await _steering(hass)

    await _save_zones(hass, hass_admin_user, zone_1={"name": "Bench"})  # refused before 1.4.1
    _sync(hass, fake)
    c._check_setups()  # the controller's next pass
    assert room.setup_revision == 2 and room._setup_pending is None
    assert room.zone_names[1] == "Bench"
    assert c._blocked(room, 1) != controller.SETUP_WAITING


async def test_remapping_a_valve_still_needs_watering_off_and_waits_a_pass_for_it(
    hass, controller_for, hass_admin_user
):
    hass.states.async_set("switch.gt1_second_valve", "off")
    await _install(hass)
    c, fake, _clock = controller_for({"enable_flag": KILL})
    room = c.rooms[0]
    await _steering(hass)
    with pytest.raises(HomeAssistantError, match="must read OFF"):
        await _save_zones(hass, hass_admin_user, zone_1={"valve": "switch.gt1_second_valve"})

    # Saved with watering off, then switched straight back on, as GT4 was.
    await hass.services.async_call("switch", "turn_off", {"entity_id": KILL}, blocking=True)
    await _save_zones(hass, hass_admin_user, zone_1={"valve": "switch.gt1_second_valve"})
    await _steering(hass)
    _sync(hass, fake)
    c._check_setups()
    assert room._setup_pending == controller.SETUP_WAITING and room.hw["valves"] == {1: VALVE}

    await hass.services.async_call("switch", "turn_off", {"entity_id": KILL}, blocking=True)
    _sync(hass, fake)
    c._check_setups()  # one pass, not the five-minute re-scan
    assert room._setup_pending is None and room.hw["valves"] == {1: "switch.gt1_second_valve"}
