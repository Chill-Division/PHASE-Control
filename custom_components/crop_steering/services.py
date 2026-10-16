"""PHASE Control services."""

from __future__ import annotations

import logging

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.util import dt as dt_util

from .admin import async_require_admin
from .const import (
    DOMAIN,
    MIN_ZONES,
    MAX_ZONES,
    SERVICE_SET_MANUAL_OVERRIDE,
)
from .room import room_prefix

_LOGGER = logging.getLogger(__name__)


def _resolve_prefix(hass: HomeAssistant, room_slug: str | None) -> str:
    """Map a service `room` slug to its entity-id prefix.

    Omitted or "default" targets the default (un-prefixed) room, so existing
    single-room callers are unchanged. A named slug resolves to that room's
    ``<slug>_`` prefix via its config entry. An unknown slug raises — silently
    acting on a different room than the caller named is exactly the wrong-room
    hazard the room parameter exists to prevent.
    """
    if not room_slug or room_slug == "default":
        return ""
    for entry in hass.config_entries.async_entries(DOMAIN):
        data = getattr(entry, "data", None) or {}
        if (
            data.get("room_slug") == room_slug
            or room_prefix(entry).rstrip("_") == room_slug
        ):
            return room_prefix(entry)
    raise HomeAssistantError(
        f"Unknown crop_steering room '{room_slug}' — no config entry has that slug"
    )


# Service schemas
MANUAL_OVERRIDE_SCHEMA = vol.Schema(
    {
        vol.Required("zone"): vol.Range(min=MIN_ZONES, max=MAX_ZONES),
        vol.Optional("timeout_minutes"): vol.Range(min=1, max=1440),  # Max 24 hours
        vol.Optional("enable"): cv.boolean,
        vol.Optional("room"): cv.string,
    }
)

SERVICES = {
    SERVICE_SET_MANUAL_OVERRIDE: {
        "schema": MANUAL_OVERRIDE_SCHEMA,
        "method": "async_set_manual_override",
    },
}


async def async_setup_services(hass: HomeAssistant) -> None:
    """Set up services for crop steering."""

    async def async_set_manual_override(call: ServiceCall) -> None:
        """Set a timed manual override; omitted timeout defaults to one hour."""
        zone = call.data["zone"]
        timeout_minutes = call.data.get("timeout_minutes", 60)  # Default 1 hour
        enable = call.data.get("enable", True)
        room = call.data.get("room")
        prefix = _resolve_prefix(hass, room)

        _LOGGER.info(
            f"Manual override requested: Zone {zone}, Enable: {enable}, Timeout: {timeout_minutes}min"
        )

        # The loaded RestoreEntity owns its deadline and scheduler. The controller
        # currently reads canonical IDs, so reject a renamed switch before success.
        key = f"{prefix}zone_{zone}_manual_override"
        override = hass.data.get(DOMAIN, {}).get("_manual_overrides", {}).get(key)
        if override is None or not override._override_loaded:
            raise HomeAssistantError(
                f"Manual override for room {room or 'default'} zone {zone} is not loaded"
            )
        expected_entity_id = f"switch.{DOMAIN}_{key}"
        if override.entity_id != expected_entity_id:
            raise HomeAssistantError(
                f"Restore the manual override entity ID to {expected_entity_id} in "
                "Home Assistant before using timed overrides; the controller cannot "
                f"read its renamed ID {override.entity_id}"
            )
        await override.async_set_manual_override(enable, timeout_minutes)

        # Preserve the public event for observers; expiry is handled by the switch.
        if enable and timeout_minutes:
            hass.bus.async_fire(
                "crop_steering_manual_override",
                {
                    "zone": zone,
                    "action": "enable_with_timeout",
                    "timeout_minutes": timeout_minutes,
                    "expires_at": override.extra_state_attributes[
                        "manual_override_expires_at"
                    ],
                    "room": room or "default",
                    "timestamp": dt_util.now().isoformat(),
                },
            )
        else:
            hass.bus.async_fire(
                "crop_steering_manual_override",
                {
                    "zone": zone,
                    "action": "disable" if not enable else "enable_permanent",
                    "room": room or "default",
                    "timestamp": dt_util.now().isoformat(),
                },
            )

        _LOGGER.info(
            f"Manual override set for Zone {zone}: {'Enabled' if enable else 'Disabled'}"
        )

    # Register services
    for service_name, service_config in SERVICES.items():
        handler = _admin_only(hass, service_name, locals()[service_config["method"]])
        hass.services.async_register(
            DOMAIN, service_name, handler, schema=service_config["schema"]
        )

    _LOGGER.info("Crop steering services registered")


def _admin_only(hass: HomeAssistant, service_name: str, handler):
    """The handler, run only once the caller has passed the administrator check."""

    async def guarded(call: ServiceCall) -> None:
        await async_require_admin(hass, call, f"{DOMAIN}.{service_name}")
        await handler(call)

    return guarded


async def async_unload_services(hass: HomeAssistant) -> None:
    """Unload services."""
    for service_name in SERVICES:
        hass.services.async_remove(DOMAIN, service_name)

    _LOGGER.info("Crop steering services unloaded")
