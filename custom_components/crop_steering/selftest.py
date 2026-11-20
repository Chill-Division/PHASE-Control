"""A zone's buttons, pressed from the dashboard: a test (Settings, Rooms & hardware, Tests) and
relearning the zone's peak (Irrigation strategy, Auto setpoints).

test_shot presses a zone's Test Shot button (button.py), which the controller app reads by entity id
and answers with a 10-second shot in that zone, through every check a shot passes but a held grow
plan's. relearn_peak presses its Relearn Peak button, and the controller's Auto setpoints forgets the
peak it learned for the zone. Response-only, by canonical room id ("room:" and the room's prefix),
for an administrator, like feed_mix, which the test refill calls.
"""

from __future__ import annotations

from .admin import async_require_admin
from .const import DOMAIN

# Each service, and the zone button it presses.
BUTTONS = {"test_shot": "test_shot", "relearn_peak": "relearn_peak"}
SERVICES = tuple(BUTTONS)


def zone_button(room_id, zone, button="test_shot") -> str:
    """A zone's button (`test_shot`, `relearn_peak`), by the room's canonical id."""
    if not isinstance(room_id, str) or not room_id.startswith("room:"):
        raise ValueError("A canonical room_id is required")
    return f"button.{DOMAIN}_{room_id[len('room:'):]}zone_{zone}_{button}"


def shot_button(room_id, zone) -> str:
    """The zone's Test Shot button, by the room's canonical id."""
    return zone_button(room_id, zone, "test_shot")


async def async_setup_selftest(hass):
    import voluptuous as vol
    from homeassistant.core import SupportsResponse
    from homeassistant.exceptions import HomeAssistantError

    async def handle(call):
        await async_require_admin(hass, call, f"{DOMAIN}.{call.service}")
        try:
            entity_id = zone_button(
                call.data["room_id"], call.data["zone"], BUTTONS[call.service]
            )
            state = hass.states.get(entity_id)
            if state is None or state.state == "unavailable":
                what = "to test" if call.service == "test_shot" else "to relearn"
                raise ValueError(f"This room has no zone {call.data['zone']} {what}")
            await hass.services.async_call(
                "button",
                "press",
                {"entity_id": entity_id},
                blocking=True,
                context=call.context,
            )
            pressed = hass.states.get(entity_id)
            return {"requested": pressed.state if pressed else None}
        except (ValueError, KeyError) as error:
            raise HomeAssistantError(str(error)) from error

    for service in SERVICES:
        hass.services.async_register(
            DOMAIN,
            service,
            handle,
            schema=vol.Schema(
                {
                    vol.Required("room_id"): str,
                    vol.Required("zone"): vol.All(int, vol.Range(min=1)),
                }
            ),
            supports_response=SupportsResponse.ONLY,
        )


async def async_unload_selftest(hass):
    """Remove the service with the last room (feed_api's rooms, unloaded just before)."""
    if not hass.data.get(DOMAIN, {}).get("_feed"):
        for service in SERVICES:
            hass.services.async_remove(DOMAIN, service)
