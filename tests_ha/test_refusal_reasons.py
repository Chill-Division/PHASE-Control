"""A change Home Assistant refuses says why, on the page where it was made.

The dashboard calls the integration's room services (setup_*, strategy_*, runs_*, stock_*, feed_*)
inside Home Assistant over its websocket, the way Home Assistant's own frontend calls a service. It
used to call them over REST, where Home Assistant answers every refusal with a bare "500 Internal
Server Error" and the reason reaches only its log: renaming a room while it was watering said
"Response error: 500" and nothing more. These run Home Assistant's real web server and websocket,
and read what the dashboard reads (frontend/src/lib/client.ts): `result.response` when the service
answered, `error.message` when it refused.
"""

import pytest
from test_setup_entry import _install

pytestmark = pytest.mark.web_server
ENGINE = "switch.crop_steering_engine_enabled"


@pytest.fixture
async def call(hass, hass_ws_client):
    """Install a room, then call its services as the dashboard does."""
    await _install(hass)
    ws = await hass_ws_client(hass)

    async def call(service, data):
        await ws.send_json_auto_id(
            {
                "type": "call_service",
                "domain": "crop_steering",
                "service": service,
                "service_data": data,
                "return_response": True,
            }
        )
        return await ws.receive_json()

    return call


async def _room(call):
    return (await call("setup_read", {}))["result"]["response"]["rooms"][0]


def _renamed(room, name):
    """What Rooms & hardware sends to save a room under a new name (frontend/src/pages/setup.tsx)."""
    return {
        "entry_id": room["entry_id"],
        "expected_revision": room["revision"],
        "room_name": name,
        "active": room["active"],
        "zones": room["zones"],
        "hardware": room["hardware"],
    }


def _revalved(room, valve):
    """What Rooms & hardware sends to give zone 1 another valve."""
    zones = [dict(zone) for zone in room["zones"]]
    zones[0]["valve"] = valve
    return {**_renamed(room, room["room_name"]), "zones": zones}


async def test_a_valve_change_refused_while_watering_says_why_and_changes_nothing(
    hass, call
):
    hass.states.async_set("switch.gt1_second_valve", "off")
    room = await _room(call)
    await hass.services.async_call(
        "switch", "turn_on", {"entity_id": ENGINE}, blocking=True
    )
    answer = await call("setup_save", _revalved(room, "switch.gt1_second_valve"))
    assert answer["success"] is False
    assert answer["error"]["message"] == (
        f"{ENGINE} must read OFF before changing setup (it is ON: turn it off, then submit again)"
    )
    after = await _room(call)
    assert (after["zones"][0]["valve"], after["revision"]) == (
        room["zones"][0]["valve"],
        room["revision"],
    )


async def test_a_rename_is_saved_with_watering_on(hass, call):
    """It changes nothing the controller switches (GT4, 2026-10-19: mapping the tank's sensor
    meant watering off and on again, and the room was held for it)."""
    room = await _room(call)
    await hass.services.async_call(
        "switch", "turn_on", {"entity_id": ENGINE}, blocking=True
    )
    answer = await call("setup_save", _renamed(room, "Growroom 2"))
    assert answer["success"] is True
    assert answer["result"]["response"]["revision"] == room["revision"] + 1


async def test_with_watering_off_the_rename_is_saved_and_answered(hass, call):
    room = await _room(call)
    answer = await call("setup_save", _renamed(room, "Growroom 2"))
    assert answer["success"] is True
    saved = answer["result"]["response"]
    assert (saved["room_name"], saved["revision"]) == (
        "Growroom 2",
        room["revision"] + 1,
    )
    await hass.async_block_till_done()


async def test_every_family_of_room_services_says_why(call):
    """The stock tanks, as one of the other pages: a save against a stale revision."""
    answer = await call(
        "stock_save", {"room_id": "room:", "expected_revision": 99, "tanks": []}
    )
    assert answer["success"] is False
    assert answer["error"]["message"] == "Stock tanks changed elsewhere. Reload before saving."


async def test_a_service_this_integration_lacks_is_not_found(call):
    """What the dashboard turns into "needs the updated PHASE Control integration"."""
    answer = await call("no_such_service", {})
    assert answer["error"]["code"] == "not_found"
