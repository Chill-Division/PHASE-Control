"""Controls from before 1.0 that nothing waters by are gone, from new rooms and upgraded ones.

The room-level Irrigation Phase select (the controller keeps each zone's phase itself), the Strategy
Stage select and its apply_recipe / save_recipe services (a stage picked in Home Assistant rewrote
every zone's targets, outside the dashboard's review), the room-level P2 EC thresholds and P3 EC
targets, and the three display sensors only those fed: current_phase, ec_ratio and
p2_vwc_threshold_adjusted.
"""

from homeassistant.helpers import entity_registry as er
from test_setup_entry import _install
from test_upgrade_in_place import _upgrade

DOMAIN = "crop_steering"
REMOVED = {
    "select.crop_steering_irrigation_phase": "irrigation_phase",
    "select.crop_steering_recipe_stage": "recipe_stage",
    "number.crop_steering_p2_ec_high_threshold": "p2_ec_high_threshold",
    "number.crop_steering_p2_ec_low_threshold": "p2_ec_low_threshold",
    "number.crop_steering_ec_target_veg_p3": "ec_target_veg_p3",
    "number.crop_steering_ec_target_gen_p3": "ec_target_gen_p3",
    "sensor.crop_steering_current_phase": "current_phase",
    "sensor.crop_steering_ec_ratio": "ec_ratio",
    "sensor.crop_steering_p2_vwc_threshold_adjusted": "p2_vwc_threshold_adjusted",
}


def _gone(hass):
    registry = er.async_get(hass)
    for entity_id in REMOVED:
        assert registry.async_get(entity_id) is None, entity_id
        assert hass.states.get(entity_id) is None, entity_id
    for service in ("apply_recipe", "save_recipe"):
        assert not hass.services.has_service(DOMAIN, service), service


async def test_a_new_room_has_none_of_them(hass):
    await _install(hass)
    _gone(hass)
    # What a room does water by is all still there.
    for entity_id in (
        "number.crop_steering_ec_target_gen_p2",
        "number.crop_steering_p2_vwc_threshold",
        "select.crop_steering_zone_1_steering_mode",
        "sensor.crop_steering_configured_avg_ec",
    ):
        assert hass.states.get(entity_id) is not None, entity_id
    assert hass.services.has_service(DOMAIN, "set_manual_override")


async def test_an_upgraded_room_loses_them_and_keeps_its_targets(hass):
    """In-place upgrade: an older install registered all of them, with their last states."""
    await _upgrade(
        hass,
        "entry_2_17_wizard.json",
        registry_ids=REMOVED,
        restored={"select.crop_steering_recipe_stage": "Bulk"},
    )
    _gone(hass)
    assert hass.states.get("number.crop_steering_ec_target_gen_p2") is not None
