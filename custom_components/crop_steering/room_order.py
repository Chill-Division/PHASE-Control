"""The order the dashboard lists the rooms in, chosen in its Settings.

Owner, 2026-10-22: GR1 was set up after GR2, and the dashboard listed it second with no way to move
it. The order is kept for the whole installation, so every device and every person sees the same,
and each room's descriptor publishes where it comes (`room_position`), so the order arrives with the
rooms themselves and every open dashboard follows a change at once.

A room the order does not name has no position (None): a room added since, or every room before an
order has been chosen. The dashboard lists those after the rest, in its own order: the first room
set up, then the others by name. An installation from before this has no record, so nothing moves
until someone chooses an order.
"""

from __future__ import annotations

import asyncio
import re

from .const import DOMAIN

STORAGE_KEY = f"{DOMAIN}.room_order"
STORAGE_VERSION = 1
SERVICES = ("room_order_save",)
# Sent when the order changes: every room's descriptor publishes its new place.
SIGNAL = f"{DOMAIN}_room_order"
# A room's id on the dashboard and in the room services: "room:" and its entity-id prefix.
ROOM_ID = re.compile(r"^room:((?:[a-z0-9_]+_)?)$")


def clean(order) -> list[str]:
    """A stored order's room prefixes, each once and in order; anything else is dropped."""
    prefixes: list[str] = []
    for prefix in order if isinstance(order, list) else []:
        if (
            isinstance(prefix, str)
            and ROOM_ID.match("room:" + prefix)
            and prefix not in prefixes
        ):
            prefixes.append(prefix)
    return prefixes


class RoomOrder:
    """The installation's one record of the order its rooms are listed in."""

    def __init__(self, hass) -> None:
        from homeassistant.helpers.storage import Store

        self.hass = hass
        self.store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.order: list[str] = []
        self.lock = asyncio.Lock()

    async def async_init(self) -> None:
        data = await self.store.async_load()
        self.order = clean(data.get("order") if isinstance(data, dict) else None)

    def position(self, prefix: str) -> int | None:
        """Where the order puts the room with this prefix, from 0; None if it names it nowhere."""
        return self.order.index(prefix) if prefix in self.order else None

    async def save(self, room_ids) -> dict:
        """List the rooms in this order from now on: each id a room of this installation, once."""
        from homeassistant.helpers.dispatcher import async_dispatcher_send

        from .room import room_prefix

        rooms = {
            room_prefix(entry)
            for entry in self.hass.config_entries.async_entries(DOMAIN)
        }
        prefixes: list[str] = []
        for room_id in room_ids:
            match = ROOM_ID.match(room_id) if isinstance(room_id, str) else None
            if match is None or match[1] not in rooms:
                raise ValueError(f"There is no room {room_id!r} to put in order")
            if match[1] in prefixes:
                raise ValueError(f"{room_id} is in the order twice")
            prefixes.append(match[1])
        async with self.lock:
            self.order = prefixes
            await self.store.async_save({"order": prefixes})
        async_dispatcher_send(self.hass, SIGNAL)
        return {"order": [f"room:{prefix}" for prefix in prefixes]}


async def async_setup_room_order(hass, entry) -> None:
    """Once per start, with the first room that sets up and before its entities, whose descriptor
    publishes the room's place: load the order and register the service."""
    import voluptuous as vol
    from homeassistant.core import SupportsResponse
    from homeassistant.exceptions import HomeAssistantError

    from .admin import async_require_admin

    data = hass.data.setdefault(DOMAIN, {})
    data.setdefault("_room_order_entries", set()).add(entry.entry_id)
    if "_room_order" in data:
        return
    manager = RoomOrder(hass)
    data["_room_order"] = manager
    await manager.async_init()

    async def handle(call):
        # It changes the order every person's dashboard lists the rooms in.
        await async_require_admin(hass, call, f"{DOMAIN}.{call.service}")
        try:
            return await manager.save(call.data["rooms"])
        except ValueError as error:
            raise HomeAssistantError(str(error)) from error

    hass.services.async_register(
        DOMAIN,
        "room_order_save",
        handle,
        schema=vol.Schema({vol.Required("rooms"): [str]}),
        supports_response=SupportsResponse.OPTIONAL,
    )


async def async_unload_room_order(hass, entry) -> None:
    data = hass.data.get(DOMAIN, {})
    entries = data.get("_room_order_entries", set())
    entries.discard(entry.entry_id)
    if not entries and data.pop("_room_order", None) is not None:
        for service in SERVICES:
            hass.services.async_remove(DOMAIN, service)
