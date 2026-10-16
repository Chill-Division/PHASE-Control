"""The PHASE Control integration."""

from __future__ import annotations

import logging
import re

from typing import Any

try:
    from homeassistant.config_entries import ConfigEntry
    from homeassistant.const import Platform
    from homeassistant.core import HomeAssistant, callback
    from homeassistant.exceptions import ConfigEntryNotReady
    from homeassistant.helpers import config_validation as cv
except ImportError:  # pragma: no cover - enables non-HA unit tests
    ConfigEntry = Any  # type: ignore
    HomeAssistant = Any  # type: ignore
    ConfigEntryNotReady = Exception  # type: ignore
    cv = None  # type: ignore

    def callback(func):  # type: ignore
        return func

    class Platform:  # type: ignore
        SENSOR = "sensor"
        SWITCH = "switch"
        SELECT = "select"
        NUMBER = "number"
        BUTTON = "button"


from .const import DOMAIN

# Set up from the UI only: nothing is read from configuration.yaml. Saying so is what hassfest asks
# of an integration with async_setup, and Home Assistant then tells anyone who writes a
# `crop_steering:` block that it is ignored, instead of ignoring it without a word.
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN) if cv else None

try:
    from .services import async_setup_services, async_unload_services
except ImportError:  # pragma: no cover - enables non-HA unit tests

    async def async_setup_services(_hass: HomeAssistant) -> None:
        return None

    async def async_unload_services(_hass: HomeAssistant) -> None:
        return None


_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [
    Platform.SENSOR,
    Platform.SWITCH,
    Platform.SELECT,
    Platform.NUMBER,
    Platform.BUTTON,
]

# Entities earlier versions created that nothing reads or sets any more, by platform and key. A key
# starting "zone_" stands for every zone's copy (zone_3_group is "zone_group"). Setup removes them
# from the entity registry; left there, each would sit in Settings as unavailable for good.
_RETIRED = {
    "button": {"zone_trigger_shot"},
    "number": {
        "steering_intent",
        "climate_grow_day_offset",
        "veg_p0_dryback_drop_pct",
        "gen_p0_dryback_drop_pct",
        "blocked_dripper_max_shots",
        "p0_minimum_wait_time",
        "p1_maximum_shot_size",
        "p3_veg_last_irrigation",
        "p3_gen_last_irrigation",
        "ec_target_flush",
        "zone_p0_minimum_wait_time",
        "zone_p1_maximum_shot_size",
        "zone_p3_veg_last_irrigation",
        "zone_p3_gen_last_irrigation",
        "zone_ec_target_flush",
        "zone_p2_ec_high_threshold",
        "zone_p2_ec_low_threshold",
        "zone_ec_target_veg_p3",
        "zone_ec_target_gen_p3",
        "zone_shot_size_multiplier",
        # the source-water gate's limits (2.26.0: the gate is gone)
        "irrigation_ph_min",
        "irrigation_ph_max",
        "irrigation_ec_min",
        "irrigation_ec_max",
    },
    "select": {
        "crop_type",
        "steering_mode_derived",
        "zone_group",
        "zone_priority",
        "zone_crop_profile",
        "zone_phase_override",
    },
    "sensor": {"water_usage_daily", "next_irrigation_time"},
    "switch": {
        "analytics_enabled",
        "zone_dripper_protection",
        # System Enabled and Auto Irrigation Enabled: retired in 2.25.0, when the room's engine
        # switch became the one switch that stops watering, and kept hidden for older controllers.
        # One that read off still kept a room from watering, set right only in Home Assistant.
        "system_enabled",
        "auto_irrigation_enabled",
        *(
            f"intelligence_{name}_enabled"
            for name in (
                "root_zone",
                "adaptive",
                "agronomic",
                "orchestrator",
                "anomaly",
                "climate_sensing",
                "climate_timeline",
                "climate_control",
                "climate_lights",
                "climate_anomaly",
                "climate_drives_intent",
                "llm_report",
            )
        ),
    },
}


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Register setup responses even before a first room has been configured."""
    from .setup_api import async_setup_setup_services

    await async_setup_setup_services(hass)
    return True


def _link_zone_devices(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Put each zone's device under its room's, as Home Assistant's device pages show it.

    The zones' DeviceInfo did this with `via_device` until Home Assistant 2026.9 deprecated it,
    warning once per platform that it stops working in 2027.8.0. The device registry's own
    `via_device_id` does the same on every Home Assistant this integration supports, and a zone an
    older version linked already is left as it is.
    """
    from homeassistant.helpers import device_registry as dr

    registry = dr.async_get(hass)
    devices = dr.async_entries_for_config_entry(registry, entry.entry_id)
    room = next((d for d in devices if (DOMAIN, entry.entry_id) in d.identifiers), None)
    if room is None:
        return
    zone = f"{entry.entry_id}_zone_"
    for device in devices:
        if device.via_device_id != room.id and any(
            domain == DOMAIN and str(key).startswith(zone)
            for domain, key in device.identifiers
        ):
            registry.async_update_device(device.id, via_device_id=room.id)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up PHASE Control from a config entry."""
    _LOGGER.info("Setting up PHASE Control")

    # Set up the integration data
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = _entry_config(entry)
    # Before the platforms register this room's entities: a room with none was set up just now.
    fresh = _is_new_room(hass, entry)

    # Load this room's named-stage recipe (server-side Store) before the platforms
    # come up, so the recipe select + sensor can read it on setup.
    try:
        from .recipe import RecipeManager

        manager = RecipeManager(hass, entry)
        await manager.async_init()
        hass.data[DOMAIN].setdefault("_recipe", {})[entry.entry_id] = manager
    except Exception as err:  # pragma: no cover - never block setup on the recipe store
        _LOGGER.warning("Recipe store unavailable: %s", err)

    # Stock tanks: stored per room and drawn down per batch; the stock sensor reads them.
    try:
        from .stock_api import async_setup_stock

        await async_setup_stock(hass, entry)
    except Exception as err:  # pragma: no cover - never block setup on the stock store
        _LOGGER.warning("Stock tanks unavailable: %s", err)

    # Nutrient batches: the room's feed settings and recipes, which the feed plan sensor and the
    # feed stage select read, and the controller app runs.
    try:
        from .feed_api import async_setup_feed

        await async_setup_feed(hass, entry)
    except Exception as err:  # pragma: no cover - never block setup on the feed store
        _LOGGER.warning("Feed settings unavailable: %s", err)

    # Tests from the dashboard: a zone's test shot (the test refill is feed_mix).
    from .selftest import async_setup_selftest

    await async_setup_selftest(hass)

    _remove_retired_entities(hass, entry)

    # Set up platforms
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    _link_zone_devices(hass, entry)

    # Set up services
    await async_setup_services(hass)
    from .setup_api import async_setup_setup_services
    from .strategy import async_setup_strategy
    from .setup_panel import async_setup_panel

    await async_setup_setup_services(hass)
    await async_setup_strategy(hass, entry)
    from .run_api import async_setup_runs

    await async_setup_runs(hass, entry)
    await async_setup_panel(hass)
    # What's new: the release highlights the dashboard shows once after an update.
    try:
        from .whats_new import async_setup_whats_new

        await async_setup_whats_new(hass, entry, fresh)
    except Exception as err:  # pragma: no cover - never block setup on the highlights
        _LOGGER.warning("What's new unavailable: %s", err)

    # Setup health checks -> Home Assistant Repairs (read-only diagnostics)
    from datetime import timedelta

    from homeassistant.helpers.event import async_call_later, async_track_time_interval

    from .health import run_health_check

    @callback
    def _hc(_now=None):
        run_health_check(hass, entry)

    hass.data[DOMAIN].setdefault("_hc_unsubs", {})[entry.entry_id] = [
        async_call_later(hass, 60, _hc),  # first check once the add-on has booted
        async_track_time_interval(hass, _hc, timedelta(minutes=5)),  # then periodically
    ]

    # Reload the entry when its data/options change (e.g. via the options flow) so
    # entities pick up the new config without an HA restart.
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))

    _LOGGER.info("PHASE Control setup complete")

    return True


def _is_new_room(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """No registered entity yet: the room was set up just now, not on an earlier start."""
    from homeassistant.helpers import entity_registry as er

    return not er.async_entries_for_config_entry(er.async_get(hass), entry.entry_id)


def _remove_retired_entities(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Drop this room's registry entries for the entities in _RETIRED."""
    from homeassistant.helpers import entity_registry as er

    registry = er.async_get(hass)
    head = f"{DOMAIN}_{entry.entry_id}_"
    removed = 0
    for item in er.async_entries_for_config_entry(registry, entry.entry_id):
        if not str(item.unique_id).startswith(head):
            continue
        key = re.sub(r"^zone_\d+_", "zone_", item.unique_id[len(head) :])
        if key in _RETIRED.get(item.domain, ()):
            registry.async_remove(item.entity_id)
            removed += 1
    if removed:
        _LOGGER.info("Removed %d retired entities from the registry", removed)


def _entry_config(entry: ConfigEntry) -> dict[str, Any]:
    """Return the active config entry payload with options overriding base data."""
    return {
        **(getattr(entry, "data", None) or {}),
        **(getattr(entry, "options", None) or {}),
    }


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload the entry when its config is updated (options flow, reconfigure)."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if not unload_ok:
        # Platforms refused to unload â€” the entry stays loaded, so leave the
        # health checks, recipe manager and services in place.
        return False

    # Stop the health-check timers and clear any Repairs issues we raised.
    for unsub in (
        hass.data.get(DOMAIN, {}).get("_hc_unsubs", {}).pop(entry.entry_id, [])
    ):
        unsub()
    try:
        from .health import clear_all

        clear_all(hass, entry.data.get("room_slug", "default"))
    except Exception:  # pragma: no cover - defensive
        pass

    hass.data.get(DOMAIN, {}).get("_recipe", {}).pop(entry.entry_id, None)
    from .strategy import async_unload_strategy

    await async_unload_strategy(hass, entry)
    from .run_api import async_unload_runs

    await async_unload_runs(hass, entry)
    from .stock_api import async_unload_stock

    await async_unload_stock(hass, entry)
    from .feed_api import async_unload_feed

    await async_unload_feed(hass, entry)
    from .selftest import async_unload_selftest

    await async_unload_selftest(hass)
    from .whats_new import async_unload_whats_new

    await async_unload_whats_new(hass, entry)
    hass.data[DOMAIN].pop(entry.entry_id, None)

    # Unload services only when the last loaded room goes away â€” other loaded
    # entries (multi-room installs) still rely on the shared domain services.
    others_loaded = [
        e
        for e in hass.config_entries.async_loaded_entries(DOMAIN)
        if e.entry_id != entry.entry_id
    ]
    if not others_loaded:
        await async_unload_services(hass)
        from .setup_panel import async_unload_panel

        async_unload_panel(hass)

    return True
