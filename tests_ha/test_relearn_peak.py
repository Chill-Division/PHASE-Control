"""A zone's Relearn Peak, in a real Home Assistant with the real controller.

Each zone has a Relearn Peak button on its own device, named for its room. The dashboard presses it
through the integration's relearn_peak service, as the signed-in user, and at its next pass the
controller's Auto setpoints forgets the peak it learned for the zone, its log naming who asked, from
Home Assistant's logbook."""

from datetime import datetime, timedelta

import pytest
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util

import auto_setpoints
import log_words
from ha_testing import async_wait_recording_done
from test_room_tests import _seen
from test_setup_entry import _install
from test_setup_save_plumbing import _service

BUTTON = "button.crop_steering_zone_1_relearn_peak"


async def test_each_zone_has_a_relearn_peak_button_on_its_own_device_named_for_its_room(
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
    named = "button.crop_steering_flower_2_zone_1_relearn_peak"
    assert hass.states.get(named).state == "unknown"
    pressed = await _service(
        hass, hass_admin_user, "relearn_peak", {"room_id": "room:flower_2_", "zone": 1}
    )
    assert pressed["requested"] == hass.states.get(named).state != "unknown"
    assert hass.states.get(BUTTON).state == "unknown"  # the other room's is not touched
    with pytest.raises(HomeAssistantError, match="no zone 2 to relearn"):
        await _service(
            hass, hass_admin_user, "relearn_peak", {"room_id": "room:flower_2_", "zone": 2}
        )


async def test_the_dashboards_relearn_reaches_the_real_controller_which_forgets_the_zones_peak(
    hass, hass_admin_user, controller_for
):
    await _install(hass)
    c, fake, _clock = controller_for()
    room = c.rooms[0]
    room.state[1]["learn"] = {**auto_setpoints.fresh(), "peak": 88.5, "gain": 0.6}
    c._who_changed = lambda entity, value, since: None  # the logbook is the next test's

    await _service(hass, hass_admin_user, "relearn_peak", {"room_id": "room:", "zone": 1})
    _seen(hass, fake, BUTTON)
    c._relearn_if_asked(room, 1, room.state[1]["learn"], datetime.now())

    learn = room.state[1]["learn"]
    assert learn["peak"] is None and learn["gain"] == 0.6
    assert learn["relearned"] == hass.states.get(BUTTON).state
    assert not [call for call in fake.calls if call[0] == "switch"]  # it waters nothing


@pytest.fixture
def mock_recorder_before_hass(async_test_recorder):
    """The recorder's database is made before Home Assistant is (see test_logbook_names_who.py)."""


@pytest.mark.web_server
async def test_the_logbook_says_who_pressed_it_as_the_controller_reads_it(
    recorder_mock, hass, hass_admin_user, hass_client
):
    assert await async_setup_component(hass, "logbook", {})
    assert await async_setup_component(
        hass,
        "person",
        {"person": [{"id": "sam", "name": "Sam", "user_id": hass_admin_user.id}]},
    )
    await _install(hass)
    start = dt_util.utcnow() - timedelta(seconds=1)
    await _service(hass, hass_admin_user, "relearn_peak", {"room_id": "room:", "zone": 1})
    await hass.async_block_till_done()
    await async_wait_recording_done(hass)
    pressed = hass.states.get(BUTTON).state

    # As the controller asks for it: REST, by the button and from a minute before the press.
    client = await hass_client()
    response = await client.get(
        f"/api/logbook/{start.isoformat()}",
        params={"end_time": (dt_util.utcnow() + timedelta(seconds=1)).isoformat(), "entity": BUTTON},
    )
    assert response.status == 200
    entries = await response.json()
    assert log_words.who(entries, pressed, {hass_admin_user.id: "Sam"}) == "Sam"
