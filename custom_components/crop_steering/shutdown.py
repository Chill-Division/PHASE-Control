"""Switch a room's pumps, valves and dosers off as Home Assistant shuts down.

The controller app drives the hardware from its own container, and it goes on running while Home
Assistant restarts or updates. Home Assistant going away leaves every device as it was: a relay that
was on stays on with nothing watching it, so a refill's pump, its fresh water or a doser, or a shot,
runs on for as long as Home Assistant is away. On Home Assistant 2026.11.2 a relay on an ESPHome
device stayed on right through a restart.

A restart, a Core update and a host shutdown from Home Assistant all stop Core the same way: the
Supervisor stops it and Core runs its shutdown stages. The first stage runs every shutdown job and
gives them up to 20 seconds, while every device is still connected (ESPHome closes its connections
only in the last stage). In that time each room switches off what it has mapped that is on, so
nothing PHASE runs is left running while Home Assistant is away. This is the only place the
integration switches hardware, and it only ever switches it off. A power cut, a crash or a network
drop never reaches this code: only a device's own failsafe covers those.

The room's descriptor says Home Assistant is shutting down first (`shutting_down_at`), so a
controller that reads a switch going off in the moment before Home Assistant stops answering can tell
it from a person switching it off, and pauses a refill instead of stopping it.
"""

from __future__ import annotations

import asyncio
import logging

from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.util import dt as dt_util

from .const import CONF_NUM_ZONES, DOMAIN
from .room import build_engine_config, room_prefix, switch_off_order

_LOGGER = logging.getLogger(__name__)

# Of the 20 seconds Home Assistant gives all shutdown jobs, what this one may take: a Zigbee or
# Z-Wave switch waits for its device to answer, and one that never does must not hold the rest.
SWITCH_OFF_TIMEOUT_S = 10.0
# Off already, or nothing can be switched: left alone.
_NOT_ON = frozenset({"off", "closed", "unavailable", "unknown"})


def shutting_down_signal(entry_id: str) -> str:
    """What the room's descriptor (sensor.py) listens for, to say Home Assistant is shutting down."""
    return f"{DOMAIN}_shutting_down_{entry_id}"


def _descriptor(hass: HomeAssistant, entry) -> dict:
    """The room's hardware map as its descriptor publishes it, from the entry as it is now."""
    config = (hass.data.get(DOMAIN) or {}).get(entry.entry_id) or {}
    return build_engine_config(
        room_prefix(entry),
        entry.data.get("room_slug", "default"),
        config.get(CONF_NUM_ZONES, 1),
        config.get("zones", {}),
        config.get("hardware", {}),
        config,
    )


async def _switch_off(hass: HomeAssistant, entity_id: str) -> None:
    domain = entity_id.split(".", 1)[0]
    await hass.services.async_call(
        "switch" if domain == "switch" else "homeassistant",
        "turn_off",
        {"entity_id": entity_id},
        blocking=True,
    )


async def async_switch_off_at_shutdown(hass: HomeAssistant, entry) -> None:
    """Home Assistant is shutting down: say so on the room's descriptor, then switch off whatever the
    room has mapped that is on, what moves water or nutrient first (switch_off_order).
    """
    async_dispatcher_send(
        hass, shutting_down_signal(entry.entry_id), dt_util.utcnow().isoformat()
    )
    groups = [
        [
            entity
            for entity in group
            if (state := hass.states.get(entity)) is not None
            and state.state not in _NOT_ON
        ]
        for group in switch_off_order(_descriptor(hass, entry))
    ]
    if not any(groups):
        return
    switched, failed = [], {}
    try:
        async with asyncio.timeout(SWITCH_OFF_TIMEOUT_S):
            for group in groups:
                results = await asyncio.gather(
                    *(_switch_off(hass, entity) for entity in group),
                    return_exceptions=True,
                )
                for entity, result in zip(group, results):
                    if isinstance(result, BaseException):
                        failed[entity] = str(result) or type(result).__name__
                    else:
                        switched.append(entity)
    except TimeoutError:
        for group in groups:
            for entity in group:
                if entity not in switched and entity not in failed:
                    failed[entity] = f"no answer in {SWITCH_OFF_TIMEOUT_S:g} s"
    if switched:
        _LOGGER.warning(
            "Home Assistant is shutting down: switched off %s, so nothing PHASE runs is left "
            "running while Home Assistant is away",
            ", ".join(switched),
        )
    if failed:
        _LOGGER.error(
            "Home Assistant is shutting down: could not switch off %s",
            ", ".join(f"{entity} ({why})" for entity, why in failed.items()),
        )
