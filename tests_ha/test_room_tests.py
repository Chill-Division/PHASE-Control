"""Settings → Rooms & hardware → Tests, in a real Home Assistant with the real controller.

Each zone has a Test Shot button on its own device, named for its room; the dashboard's test shot
presses it through the integration's test_shot service, and the controller waters that zone for 10
seconds at its next pass, a test shot and not one of the day's shots. The test refill is feed_mix;
with "Run anyway" (force) the feed plan sensor says so before the press, and the controller then starts
a refill it would refuse as one that could overflow the reservoir.
"""

from datetime import datetime

import pytest
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from test_feed_batches import FLOWER, RESERVOIR
from test_real_flow import VALVE
from test_setup_entry import _install
from test_setup_save_plumbing import _payload, _room, _service

BUTTON = "button.crop_steering_zone_1_test_shot"
MIX = "button.crop_steering_mix_batch"
PLAN = "sensor.crop_steering_feed_plan"
KILL = "switch.crop_steering_engine_enabled"
ARMED = (
    KILL,
    "switch.crop_steering_zone_1_enabled",
)


def _seen(hass, fake, *entity_ids):
    """What Home Assistant now says about these, as the controller reads it over REST."""
    for entity_id in entity_ids:
        state = hass.states.get(entity_id)
        fake.set_state(entity_id, state.state, dict(state.attributes))


async def test_each_zone_has_a_test_shot_button_on_its_own_device_named_for_its_room(
    hass, hass_admin_user
):
    await _install(hass)
    assert hass.states.get(BUTTON).state == "unknown"  # never pressed
    registry = er.async_get(hass)
    zone_device = registry.async_get("number.crop_steering_zone_1_plant_count").device_id
    assert registry.async_get(BUTTON).device_id == zone_device

    hass.states.async_set("switch.flower_2_valve", "off")
    await _service(
        hass,
        hass_admin_user,
        "setup_create",
        {
            "room_name": "Flower 2",
            "active": True,
            "plumbing": "valves_only",
            "hardware": {},
            "zones": [
                {
                    "id": 1,
                    "name": "Bench",
                    "active": True,
                    "valve": "switch.flower_2_valve",
                    "vwc_sensors": [],
                    "ec_sensors": [],
                    "plant_count": 4,
                }
            ],
        },
    )
    await hass.async_block_till_done()
    named = "button.crop_steering_flower_2_zone_1_test_shot"
    assert hass.states.get(named).state == "unknown"
    pressed = await _service(
        hass, hass_admin_user, "test_shot", {"room_id": "room:flower_2_", "zone": 1}
    )
    assert pressed["requested"] == hass.states.get(named).state != "unknown"
    assert hass.states.get(BUTTON).state == "unknown"  # the other room's is not touched
    with pytest.raises(HomeAssistantError, match="no zone 2 to test"):
        await _service(
            hass, hass_admin_user, "test_shot", {"room_id": "room:flower_2_", "zone": 2}
        )


async def test_the_dashboards_test_shot_waters_the_zone_through_the_real_controller(
    hass, hass_admin_user, controller_for
):
    await _install(hass)
    c, fake, _clock = controller_for({"enable_flag": KILL})
    room = c.rooms[0]
    for switch in ARMED:
        fake.set_state(switch, "on")
    c.loop_once(datetime.now())  # the button's state now is where the controller starts from
    shots = room.state[1]["shots"]
    fake.calls.clear()

    await _service(hass, hass_admin_user, "test_shot", {"room_id": "room:", "zone": 1})
    _seen(hass, fake, BUTTON)
    c.loop_once(datetime.now())
    assert [
        (service, data["entity_id"])
        for domain, service, data in fake.calls
        if domain == "switch" and data["entity_id"] == VALVE
    ] == [("turn_on", VALVE), ("turn_off", VALVE)]
    assert room.state[1]["shots"] == shots  # a test, not one of the day's shots
    assert fake.sets["sensor.crop_steering_zone_1_status_app"][0] == "Test shot"


async def test_a_test_refill_run_anyway_reaches_the_real_controller(
    hass, hass_admin_user, controller_for
):
    """The reservoir reads 76% full, and no refill has shown yet what its fill raises it by: asked for
    by hand, the controller refuses it as one that could overflow. Run anyway, it starts."""
    hass.states.async_set("switch.pump", "off")
    hass.states.async_set("sensor.res_distance", "300", {"unit_of_measurement": "mm"})
    for entity in list(RESERVOIR.values())[1:]:
        hass.states.async_set(entity, "off")
    await _install(hass, {"pump_switch": "switch.pump"})
    room = await _room(hass, hass_admin_user)
    await _service(hass, hass_admin_user, "setup_save", _payload(room, hardware=RESERVOIR))
    await hass.async_block_till_done()
    doc = await _service(hass, hass_admin_user, "feed_get", {"room_id": "room:"})
    await _service(
        hass,
        hass_admin_user,
        "feed_save",
        {
            "room_id": "room:",
            "expected_revision": doc["revision"],
            "document": {
                "batch_l": 145,
                "fill_s": 690,
                "full_mm": 125,
                "empty_mm": 850,
                "recipes": [FLOWER],
                "stage": "flower",
            },
        },
    )
    assert hass.states.get(PLAN).attributes["mix_force_until"] is None

    c, fake, _clock = controller_for({"enable_flag": KILL})
    controller_room = c.rooms[0]
    fake.set_state(KILL, "on")
    c._batch_tick(controller_room, datetime.now())  # the button's state now is where it starts

    await _service(hass, hass_admin_user, "feed_mix", {"room_id": "room:"})
    _seen(hass, fake, MIX, PLAN)
    c._batch_tick(controller_room, datetime.now())
    assert controller_room.batch["step"] == "idle"
    refused = [
        data["message"]
        for domain, service, data in fake.calls
        if (domain, service) == ("persistent_notification", "create")
        and "(CS-703)" in data.get("title", "")
    ]
    assert refused and "reads 76%" in refused[0]

    await _service(hass, hass_admin_user, "feed_mix", {"room_id": "room:", "force": True})
    assert hass.states.get(PLAN).attributes["mix_force_until"] is not None
    _seen(hass, fake, MIX, PLAN)
    c._batch_tick(controller_room, datetime.now())
    assert controller_room.batch["step"] == "filling"
    assert ("switch", "turn_on", {"entity_id": "switch.mainswater"}) in fake.calls
