"""Config flow for the PHASE Control integration."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import selector

from .const import (
    SOFTWARE_VERSION,
    DOMAIN,
    CONF_NUM_ZONES,
    MIN_ZONES,
    MAX_ZONES,
    DEFAULT_NUM_ZONES,
    PRODUCT_NAME,
)
from .plumbing import ONE_VALVE_LAYOUTS, PLUMBING_LAYOUTS, infer as infer_plumbing
from .room import slugify_room
from .setup_api import RETIRED_HARDWARE

_LOGGER = logging.getLogger(__name__)


# --------------------------------------------------------------------------
# UI entity-mapping helpers (shared by the setup wizard and the reconfigure flow)
# --------------------------------------------------------------------------
def _sw_sel():
    return selector.EntitySelector(selector.EntitySelectorConfig(domain="switch"))


def _sensor_multi():
    return selector.EntitySelector(
        selector.EntitySelectorConfig(domain="sensor", multiple=True)
    )


def _sensor_one():
    return selector.EntitySelector(selector.EntitySelectorConfig(domain="sensor"))


def _plumbing_sel():
    # Shown as a list, not a dropdown: five choices, and a newcomer should see all of them.
    return selector.SelectSelector(
        selector.SelectSelectorConfig(
            options=list(PLUMBING_LAYOUTS),
            translation_key="plumbing",
            mode=selector.SelectSelectorMode.LIST,
        )
    )


def _one_valve(plumbing) -> bool:
    """One valve waters every zone at once (ONE_VALVE_LAYOUTS): it is asked for once, not a zone's."""
    return isinstance(plumbing, str) and plumbing in ONE_VALVE_LAYOUTS


def _count_schema(num_zones: int, plumbing: str | None = None) -> dict:
    """How many zones, and how the room is plumbed. Asked together, before the zones are mapped, so
    the zones' screen asks for a valve each only where each zone has one (owner, 2026-10-22: one
    fertigation valve for three zones). `plumbing` prefills what the room declared, or for a room
    from before the question existed, what its switches imply; a new room gets no prefill, so the
    person setting it up answers it rather than accepting a guess."""
    return {
        vol.Required(CONF_NUM_ZONES, default=num_zones): vol.All(
            vol.Coerce(int), vol.Range(min=MIN_ZONES, max=MAX_ZONES)
        ),
        (
            vol.Required("plumbing", default=plumbing)
            if plumbing
            else vol.Required("plumbing")
        ): _plumbing_sel(),
    }


def _as_list(v):
    if not v:
        return []
    return list(v) if isinstance(v, (list, tuple)) else [v]


def _archived(zc: dict) -> bool:
    return zc.get("active") is False


def _zone_schema(
    num_zones: int, zones: dict | None = None, plumbing: str | None = None
) -> dict:
    """Build the {marker: selector} map for per-zone entity mapping, prefilled from
    an existing `zones` dict (the config entry's shape).

    Each zone's valve and its substrate probes, moisture and EC: what a zone needs before it
    can be watered, and what is easiest to pick here. Its label, plant count and sizing, and
    archiving or restoring it, are on the dashboard's Rooms & hardware. A zone archived there
    is not asked for here, and keeps everything it had. A room whose one valve waters every
    zone (`plumbing`, ONE_VALVE_LAYOUTS) is asked for that valve once, first.
    """
    zones = zones or {}
    out: dict = {}
    if _one_valve(plumbing):
        mapped = {
            zc.get("zone_switch")
            for zc in zones.values()
            if not _archived(zc) and zc.get("zone_switch")
        }
        shared = next(iter(mapped)) if len(mapped) == 1 else ""
        out[
            (
                vol.Required("shared_valve", default=shared)
                if shared
                else vol.Required("shared_valve")
            )
        ] = _sw_sel()
    for z in range(1, int(num_zones) + 1):
        zc = zones.get(str(z)) or zones.get(z) or {}
        if _archived(zc):
            continue
        sw = zc.get("zone_switch") or ""
        vwc = zc.get("vwc_sensors") or (
            _as_list(zc.get("vwc_front")) + _as_list(zc.get("vwc_back"))
        )
        ec = zc.get("ec_sensors") or (
            _as_list(zc.get("ec_front")) + _as_list(zc.get("ec_back"))
        )
        if not _one_valve(plumbing):
            out[
                (
                    vol.Required(f"zone_{z}_switch", default=sw)
                    if sw
                    else vol.Required(f"zone_{z}_switch")
                )
            ] = _sw_sel()
        out[vol.Optional(f"zone_{z}_vwc", default=vwc)] = _sensor_multi()
        out[vol.Optional(f"zone_{z}_ec", default=ec)] = _sensor_multi()
    return out


def _hardware_schema(
    hardware: dict | None = None,
    params: dict | None = None,
    plumbing: str | None = None,
) -> dict:
    """Build the {marker: selector} map for the switches the room's plumbing has, and its lights
    hours.

    Pot size, drippers and their flow are each zone's, on the dashboard's Rooms & hardware; the
    targets are on Irrigation strategy → Today. A field capacity and a maximum EC asked here used
    to seed only the room's values, which every zone's own overrides: nothing the controller
    steered by ever changed.

    `plumbing`, asked with the zone count (_count_schema), decides which switches: the pump where
    the room has one, the main-line valve where it has one. A field not asked is saved empty,
    as the plumbing says it is. Without a layout, both are asked.
    """
    hardware = hardware or {}
    params = params or {}

    def _ent(key, sel):
        # Prefilled as a SUGGESTED value, not a default. With `default=` the frontend dropped an
        # emptied field and voluptuous put the default straight back, so a mapping could be
        # swapped but never removed - and the pump and main-line are optional now, so removing
        # one has to work. The form still opens showing the mapping, so a save cannot wipe it.
        val = hardware.get(key) or ""
        out[
            (
                vol.Optional(key, description={"suggested_value": val})
                if val
                else vol.Optional(key)
            )
        ] = sel

    out: dict = {}
    pump, mainline = PLUMBING_LAYOUTS.get(plumbing, (True, True))
    if pump:
        _ent("pump_switch", _sw_sel())
    if mainline:
        _ent("main_line_switch", _sw_sel())
    out[vol.Optional("lights_on_hour", default=params.get("lights_on_hour", 12))] = (
        vol.All(vol.Coerce(int), vol.Range(min=0, max=23))
    )
    out[vol.Optional("lights_off_hour", default=params.get("lights_off_hour", 0))] = (
        vol.All(vol.Coerce(int), vol.Range(min=0, max=23))
    )
    return out


def _build_zones(num_zones: int, data: dict, existing: dict | None = None) -> dict:
    """Build the config entry's `zones` dict from submitted form data.

    Only a zone's valve and probes come from the form. Its label, plant count, sizing and daily
    limit stay what the room has (a new zone gets the defaults), so a save here never resets
    what Rooms & hardware set. Zones above the count are archived; a zone archived on Rooms &
    hardware, which the form does not ask for, stays as it is.
    """
    existing = {str(k): v for k, v in (existing or {}).items()}
    zones: dict = {k: {**v, "active": False} for k, v in existing.items()}
    for z in range(1, int(num_zones) + 1):
        old = existing.get(str(z)) or {}
        if _archived(old):
            zones[str(z)] = old
            continue
        vwc = _as_list(data.get(f"zone_{z}_vwc"))
        ec = _as_list(data.get(f"zone_{z}_ec"))
        zones[str(z)] = {
            **old,
            "zone_number": z,
            "active": True,
            "name": old.get("name") or f"Zone {z}",
            # One valve for every zone (_zone_schema): each zone maps it.
            "zone_switch": data.get(f"zone_{z}_switch", data.get("shared_valve", "")),
            "vwc_sensors": vwc,
            "ec_sensors": ec,
            "vwc_front": vwc[0] if vwc else "",
            "vwc_back": vwc[1] if len(vwc) > 1 else "",
            "ec_front": ec[0] if ec else "",
            "ec_back": ec[1] if len(ec) > 1 else "",
            "plant_count": int(old.get("plant_count", 4)),
            "max_daily_volume": old.get("max_daily_volume", 20.0),
        }
    return zones


def _build_hardware(data: dict) -> dict:
    return {
        "pump_switch": data.get("pump_switch", ""),
        "main_line_switch": data.get("main_line_switch", ""),
    }


def _build_parameters(data: dict, existing: dict | None = None) -> dict:
    """The recorded setup parameters: the lights hours from the form, everything else as the
    room recorded it. A new room records only its lights hours; its number entities start from
    their defaults (number.py DEFAULT_VALUES), which are what this form used to offer.
    """
    return {
        **(existing or {}),
        "lights_on_hour": data.get(
            "lights_on_hour", (existing or {}).get("lights_on_hour", 12)
        ),
        "lights_off_hour": data.get(
            "lights_off_hour", (existing or {}).get("lights_off_hour", 0)
        ),
    }


STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required("name", default=PRODUCT_NAME): str,
    }
)


# The room's photoperiod, as the two number entities the controller reads every loop.
LIGHTS_HOURS = ("lights_on_hour", "lights_off_hour")


def _retry_form(flow, step_id, schema, user_input, info, error):
    """Show the same step again with everything typed still in it, and say what is wrong.

    These steps used to abort: one entity that was ON, unreachable or mistyped threw away every
    zone, sensor and sizing entry. Home Assistant prefills a schema from the last submission.
    """
    prefill = getattr(flow, "add_suggested_values_to_schema", None)
    return flow.async_show_form(
        step_id=step_id,
        data_schema=prefill(schema, user_input) if prefill else schema,
        errors={"base": "setup_invalid"},
        description_placeholders={
            "info": f"{info}\n\n**Not saved yet.** {error}",
            "error": str(error),
        },
    )


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for PHASE Control."""

    VERSION = 1

    def __init__(self):
        """Initialize config flow."""
        self._data = {}

    def _retry(self, step_id, schema, user_input, info, error):
        return _retry_form(self, step_id, schema, user_input, info, error)

    def _check(self, data, check_plumbing=True):
        """Validate what has been entered so far, at the step it was entered on."""
        from .setup_api import configuration_payload, prepare_setup, safety_blockers

        prepared = prepare_setup(
            self.hass, configuration_payload(data), data, check_plumbing=check_plumbing
        )
        blockers = safety_blockers(self.hass, proposed=prepared)
        if blockers:
            raise ValueError("; ".join(blockers))
        return prepared

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Initial step. The first config is the default (un-prefixed) room — existing
        single-room installs are unchanged. Any further config adds another fully-isolated
        room (own zones/sensors/pump/setpoints), namespaced as crop_steering_<slug>_*.
        """
        # Never set a room up on code that is waiting for a restart: whatever it creates is
        # created by the OLD code, and entity ids are for life.
        running, waiting = await _versions(self.hass)
        if waiting:
            return self.async_abort(
                reason="restart_required",
                description_placeholders={"running": running, "installed": waiting},
            )
        if user_input is not None and "setup_payload" in user_input:
            from .setup_api import prepare_setup, safety_blockers

            try:
                data = prepare_setup(self.hass, user_input["setup_payload"])
                named = bool(self._async_current_entries())
                slug = slugify_room(data["room_name"]) if named else "default"
                if named and slug == "default":
                    return self.async_abort(reason="reserved_room_name")
                await self.async_set_unique_id(f"room_{slug}" if named else "default")
                self._abort_if_unique_id_configured()
                data.update(
                    room_slug=slug,
                    room_prefix=f"{slug}_" if named else "",
                    setup_revision=1,
                )
                data["enable_flag"] = (
                    f"switch.crop_steering_{data['room_prefix']}engine_enabled"
                )
                blockers = safety_blockers(self.hass, proposed=data)
                if blockers:
                    raise ValueError("; ".join(blockers))
                return self.async_create_entry(title=data["room_name"], data=data)
            except ValueError as err:
                return self.async_abort(
                    reason="setup_invalid", description_placeholders={"error": str(err)}
                )
        # A room already exists -> this is an additional room (UI-mapped, prefixed).
        if self._async_current_entries():
            return await self.async_step_room()

        if user_input is None:
            running, _waiting = await _versions(self.hass)
            return self.async_show_form(
                step_id="user",
                data_schema=STEP_USER_DATA_SCHEMA,
                description_placeholders={
                    "version": running,
                    "restart_notice": "",
                },
            )

        await self.async_set_unique_id("default")
        self._abort_if_unique_id_configured()
        self._data.update(user_input)
        self._data["room_prefix"] = ""
        self._data["room_name"] = user_input.get("name", PRODUCT_NAME)

        return await self.async_step_manual_zones()

    async def async_step_room(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Name an additional, fully-isolated room, then map it in the UI."""
        if user_input is None:
            return self.async_show_form(
                step_id="room",
                data_schema=vol.Schema({vol.Required("room_name"): str}),
                description_placeholders={
                    "info": "Name this room (e.g. Veg, Flower B). It gets its own zones, "
                    "sensors, pump and setpoints — completely isolated from your other rooms.",
                    "version": SOFTWARE_VERSION,
                },
            )
        slug = slugify_room(user_input["room_name"])
        if slug == "default":
            return self.async_abort(reason="reserved_room_name")
        await self.async_set_unique_id(f"room_{slug}")
        self._abort_if_unique_id_configured()
        self._data["name"] = user_input["room_name"]
        self._data["room_name"] = user_input["room_name"]
        self._data["room_slug"] = slug
        self._data["room_prefix"] = f"{slug}_"
        return await self.async_step_manual_zones()

    async def async_step_manual_zones(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """How many zones, and how the room is plumbed: what the next screens ask follows from it."""
        if user_input is None:
            return self.async_show_form(
                step_id="manual_zones",
                data_schema=vol.Schema(_count_schema(DEFAULT_NUM_ZONES)),
                description_placeholders={
                    "info": f"How many irrigation zones the room has ({MIN_ZONES}-{MAX_ZONES}), "
                    "each with its own probes, and how the water reaches them. The next screens "
                    "ask only for the switches that plumbing has."
                },
            )
        self._data[CONF_NUM_ZONES] = user_input[CONF_NUM_ZONES]
        self._data["plumbing"] = user_input["plumbing"]
        return await self.async_step_zones()

    async def async_step_zones(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Map each zone's valve and sensors via entity pickers: one valve for them all where the
        plumbing says one valve waters every zone."""
        num = int(self._data.get(CONF_NUM_ZONES, DEFAULT_NUM_ZONES))
        plumbing = self._data.get("plumbing")
        info = (
            (
                f"Pick the one valve that waters all {num} zones at once, then each zone's "
                "substrate probes. The zones share every shot, so they share one phase and one set "
                "of targets; each keeps its own readings."
                if _one_valve(plumbing)
                else f"Pick the valve and the substrate probes for each of your {num} zones."
            )
            + " You can choose more than one moisture or EC probe for a zone: the controller reads "
            "their average until you choose otherwise in the zone's details on the dashboard. Each "
            "zone's name, plant count, pot size and drippers are set there too, under Settings → "
            "Rooms & hardware."
        )
        schema = vol.Schema(_zone_schema(num, plumbing=plumbing))
        if user_input is None:
            return self.async_show_form(
                step_id="zones",
                data_schema=schema,
                description_placeholders={"info": info},
            )
        zones = _build_zones(num, user_input)
        try:  # a valve that is ON or a probe in the wrong unit is reported here, not three screens later
            self._check(
                {
                    "room_name": self._data.get("room_name", PRODUCT_NAME),
                    "room_prefix": self._data.get("room_prefix", ""),
                    "enable_flag": f"switch.crop_steering_{self._data.get('room_prefix', '')}engine_enabled",
                    "zones": zones,
                    "plumbing": plumbing,
                },
                check_plumbing=False,  # its pump and main line are the next screen's
            )
        except ValueError as err:
            return self._retry("zones", schema, user_input, info, err)
        self._data["zones"] = zones
        return await self.async_step_hardware()

    async def async_step_hardware(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Map the switches the room's plumbing has, and set its lights hours."""
        plumbing = self._data.get("plumbing")
        pump, mainline = PLUMBING_LAYOUTS.get(plumbing, (True, True))
        switches = " and ".join(
            what
            for what, has in (
                ("the pump, which runs whenever a zone waters", pump),
                ("the main-line valve that feeds the zones", mainline),
            )
            if has
        )
        info = (
            (f"Choose {switches}. " if switches else "")
            + "Then the hours the lights come on and go off: the grow-day runs from one "
            "lights-on to the next. Watering stays off until you switch it on in PHASE Control."
        )
        schema = vol.Schema(_hardware_schema(plumbing=plumbing))
        if user_input is None:
            return self.async_show_form(
                step_id="hardware",
                data_schema=schema,
                description_placeholders={"info": info},
            )
        data = {
            "name": self._data.get("name", PRODUCT_NAME),
            "room_name": self._data.get("room_name", PRODUCT_NAME),
            "room_prefix": self._data.get("room_prefix", ""),
            "room_slug": self._data.get("room_slug", "default"),
            CONF_NUM_ZONES: int(self._data.get(CONF_NUM_ZONES, DEFAULT_NUM_ZONES)),
            "zones": self._data.get("zones", {}),
            "hardware": _build_hardware(user_input),
            "parameters": _build_parameters(user_input),
        }
        data["enable_flag"] = (
            f"switch.crop_steering_{data['room_prefix']}engine_enabled"
        )
        if plumbing:
            data["plumbing"] = plumbing
        try:
            data = self._check(data)
        except ValueError as err:
            return self._retry("hardware", schema, user_input, info, err)
        data["setup_revision"] = 1
        return self.async_create_entry(title=data["name"], data=data)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        """Get the options flow for this handler."""
        return OptionsFlowHandler(config_entry)


def _installed_version() -> str | None:
    """The version in manifest.json ON DISK, which is what HACS last downloaded. Blocking: call
    it in the executor. None when it cannot be read, which never stops anybody."""
    try:
        manifest = json.loads(
            (Path(__file__).parent / "manifest.json").read_text(encoding="utf-8")
        )
        version = manifest.get("version")
    except (OSError, ValueError, AttributeError):
        return None
    return version if isinstance(version, str) and version else None


async def _versions(hass) -> tuple[str, str | None]:
    """(running, waiting). `running` is the code Home Assistant loaded when it started; HACS
    replaces the files and Home Assistant goes on running the old ones until it restarts.
    `waiting` is the version on disk when it differs, else None.

    2026-09-21: 2.19.2 was on disk, code from before 2.18.0 was running, and nothing said so.
    Setup was run twice on it, Home Assistant named every entity, and the controller could not
    find one of them.
    """
    installed = await hass.async_add_executor_job(_installed_version)
    return SOFTWARE_VERSION, (
        installed if installed and installed != SOFTWARE_VERSION else None
    )


def _restart_notice(running: str, waiting: str | None) -> str:
    if not waiting:
        return ""
    return (
        f"⚠️ Home Assistant is still running {running}, but {waiting} is installed. Restart "
        "Home Assistant to run it: an update downloaded by HACS does nothing until then."
    )


class OptionsFlowHandler(config_entries.OptionsFlow):
    """Handle options flow for PHASE Control."""

    def __init__(self, config_entry: config_entries.ConfigEntry):
        """Initialize options flow."""
        self._entry = config_entry
        self._edit_num: int | None = None
        self._edit_plumbing: str | None = None

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Manage the options."""
        running, waiting = await _versions(self.hass)
        return self.async_show_menu(
            step_id="init",
            menu_options=[
                "edit_zones",
                "open_dashboard",
            ],
            # Not blocked while an update waits for a restart: an operator with a growing room
            # has to be able to get in here. It is told what is going on instead.
            description_placeholders={
                "version": running,
                "restart_notice": _restart_notice(running, waiting),
            },
        )

    def _number_id(self, key: str) -> str:
        from .setup_api import effective

        prefix = effective(self._entry).get("room_prefix", "")
        return f"number.crop_steering_{prefix}{key}"

    def _live_numbers(self, keys) -> dict:
        """{key: value} for each of this room's number entities that has a numeric state."""
        live = {}
        for key in keys:
            state = self.hass.states.get(self._number_id(key))
            try:
                live[key] = float(state.state)
            except (AttributeError, TypeError, ValueError):
                continue  # absent or unavailable: the caller falls back to what setup recorded
        return live

    async def _set_live_numbers(self, values: dict) -> None:
        for key, value in values.items():
            if self.hass.states.get(self._number_id(key)) is None:
                continue
            await self.hass.services.async_call(
                "number",
                "set_value",
                {"entity_id": self._number_id(key), "value": value},
                blocking=True,
            )

    async def async_step_open_dashboard(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Where everything else is set: a note, then back out without changing anything."""
        return self.async_abort(reason="use_dashboard")

    async def async_step_edit_zones(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Reconfigure zones — step 1: how many zones (add or remove), and how they are plumbed."""
        from .setup_api import effective

        data = effective(self._entry)
        cur = int(data.get("num_zones", 1))
        if user_input is None:
            return self.async_show_form(
                step_id="edit_zones",
                data_schema=vol.Schema(
                    _count_schema(
                        cur,
                        data.get("plumbing")
                        or infer_plumbing(data.get("hardware", {})),
                    )
                ),
                description_placeholders={
                    "info": "Set how many zones you have, and how the room is plumbed. Increase the "
                    "count to ADD a zone, decrease it to archive the highest ones. You'll map their "
                    "valves and probes on the next screen; a zone archived in PHASE Control is "
                    "restored there, under Settings → Rooms & hardware."
                },
            )
        self._edit_num = int(user_input["num_zones"])
        self._edit_plumbing = user_input["plumbing"]
        return await self.async_step_edit_zones_map()

    async def async_step_edit_zones_map(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Reconfigure zones — step 2: remap valves/sensors and shared hardware."""
        num = getattr(self, "_edit_num", None) or int(
            self._entry.data.get("num_zones", 1)
        )
        from .setup_api import effective

        data = effective(self._entry)
        # The lights hours are the controller's: it reads them from the room's two number entities.
        # The recorded `parameters` only seed those entities the first time they are created, so
        # this form used to open on, and save, hours the controller never read (a room ran lights
        # 20-7 while Configure said 7-20). It opens on the live hours, like edit_parameters.
        live_lights = {
            key: int(round(value))
            for key, value in self._live_numbers(LIGHTS_HOURS).items()
        }
        plumbing = (
            getattr(self, "_edit_plumbing", None)
            or data.get("plumbing")
            or infer_plumbing(data.get("hardware", {}))
        )
        schema = vol.Schema(
            {
                **_zone_schema(num, data.get("zones", {}), plumbing),
                **_hardware_schema(
                    data.get("hardware", {}),
                    {**data.get("parameters", {}), **live_lights},
                    plumbing,
                ),
            }
        )
        info = (
            (
                "Swap the valve that waters every zone, each zone's substrate probes, the room's "
                "switches and its lights hours."
                if _one_valve(plumbing)
                else "Swap each zone's valve and substrate probes, the room's switches and its "
                "lights hours."
            )
            + " A zone's name, plant count, pot size and drippers are on the dashboard, under "
            "Settings → Rooms & hardware; its targets under Irrigation strategy → Today."
        )
        if user_input is None:
            return self.async_show_form(
                step_id="edit_zones_map",
                data_schema=schema,
                description_placeholders={"info": info},
            )
        new_data = {
            **data,
            "num_zones": max(num, int(data.get("num_zones", 1))),
            "zones": _build_zones(num, user_input, data.get("zones", {})),
            "hardware": {
                **{
                    key: value
                    for key, value in data.get("hardware", {}).items()
                    if key not in RETIRED_HARDWARE
                },
                **_build_hardware(user_input),
            },
            "parameters": _build_parameters(user_input, data.get("parameters", {})),
        }
        new_data["plumbing"] = plumbing
        from .setup_api import (
            configuration_payload,
            prepare_setup,
            safety_blockers,
            _update,
        )

        try:
            new_data = prepare_setup(
                self.hass,
                configuration_payload(new_data),
                new_data,
                self._entry.entry_id,
            )
            blockers = safety_blockers(self.hass, self._entry, new_data)
            if blockers:
                raise ValueError("; ".join(blockers))
        except ValueError as err:
            return _retry_form(self, "edit_zones_map", schema, user_input, info, err)
        # Write the live lights hours first, as edit_parameters does: the reload that follows
        # then restores the hours just written instead of the old ones.
        await self._set_live_numbers(
            {key: user_input[key] for key in LIGHTS_HOURS if key in user_input}
        )
        _update(self.hass, self._entry, new_data)
        return self.async_create_entry(title="", data={})
