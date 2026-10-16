"""System Enabled and Auto Irrigation Enabled are gone: the room's engine switch is the one switch.

Retired in 2.25.0 and kept, hidden, for controllers from 2.24.0 or before. While one read off,
the controller kept watering switched off in its place (CS-208), and only Home Assistant could put
it right: a room set up again came back with one off, and nothing watered until someone found it.
"""

from datetime import datetime

from homeassistant.helpers import entity_registry as er
from test_setup_entry import _install
from test_upgrade_in_place import _upgrade

KILL = "switch.crop_steering_engine_enabled"
SYSTEM = "switch.crop_steering_system_enabled"

RETIRED = {
    "switch.crop_steering_system_enabled": "system_enabled",
    "switch.crop_steering_auto_irrigation_enabled": "auto_irrigation_enabled",
}


def _gone(hass):
    registry = er.async_get(hass)
    for entity_id in RETIRED:
        assert registry.async_get(entity_id) is None, entity_id
        assert hass.states.get(entity_id) is None, entity_id


async def test_a_new_room_has_neither(hass):
    await _install(hass)
    _gone(hass)
    # The switch that does stop watering is there.
    assert er.async_get(hass).async_get("switch.crop_steering_engine_enabled") is not None


async def test_an_upgraded_room_loses_both(hass):
    """In-place upgrade: an older install registered both."""
    await _upgrade(hass, "entry_2_17_wizard.json", registry_ids=RETIRED)
    _gone(hass)


async def test_a_room_whose_system_enabled_was_left_off_waters_once_updated(hass, controller_for):
    """The 1.2.0 trap, end to end: a room whose hidden System Enabled read off. Every pass the
    controller switched watering off again (CS-208), and only Home Assistant could set it right.
    Updated, the switch is gone, and switching watering on is enough."""
    # Off is the state Home Assistant saved for it, and would restore it to as it starts.
    await _upgrade(hass, "entry_2_17_wizard.json", registry_ids=RETIRED, restored={SYSTEM: "off"})
    _gone(hass)
    c, fake, _clock = controller_for({"enable_flag": KILL})
    fake.set_state(KILL, "on")  # watering switched on, in PHASE Control
    fake.calls.clear()
    c.loop_once(datetime(2026, 10, 17, 12, 0))
    assert fake.states[KILL][0] == "on"
    assert not any(
        dom == "persistent_notification" and "(CS-208)" in data.get("title", "")
        for dom, _service, data in fake.calls
    )
