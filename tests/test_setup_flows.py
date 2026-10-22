"""Drive real native config-flow steps with a minimal HA flow host."""

import asyncio
import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest

from custom_components.crop_steering import setup_api as api

from .test_setup import rig, payload


@pytest.fixture
def flow_module(monkeypatch):
    from . import ha_stubs

    ha_stubs.install()
    entries = sys.modules["homeassistant.config_entries"]

    class Flow:
        def __init_subclass__(cls, **kwargs):
            super().__init_subclass__()

        def _async_current_entries(self):
            return self.hass.config_entries.async_entries("crop_steering")

        async def async_set_unique_id(self, unique):
            self.unique = unique

        def _abort_if_unique_id_configured(self):
            return None

        def async_create_entry(self, **data):
            return {"type": "create_entry", **data}

        def async_abort(self, **data):
            return {"type": "abort", **data}

        def async_show_form(self, **data):
            return {"type": "form", **data}

    monkeypatch.setattr(entries, "ConfigFlow", Flow, raising=False)
    monkeypatch.setattr(entries, "OptionsFlow", Flow, raising=False)
    flow = ModuleType("homeassistant.data_entry_flow")
    flow.FlowResult = dict
    monkeypatch.setitem(sys.modules, "homeassistant.data_entry_flow", flow)
    selector = ModuleType("homeassistant.helpers.selector")
    selector.EntitySelector = lambda config: config
    selector.EntitySelectorConfig = lambda **data: data
    selector.SelectSelector = lambda config: config
    selector.SelectSelectorConfig = lambda **data: data
    selector.SelectSelectorMode = type("SelectSelectorMode", (), {"LIST": "list"})
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.selector", selector)
    spec = importlib.util.spec_from_file_location(
        "custom_components.crop_steering._setup_flow_test",
        Path(__file__).parents[1] / "custom_components/crop_steering/config_flow.py",
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_native_creation_retains_supported_flow_and_validates_off(flow_module):
    hass, _, states = rig()
    hass.config_entries.entries = []
    flow = flow_module.ConfigFlow()
    flow.hass = hass
    data = payload()
    data["room_name"] = "First room"
    result = asyncio.run(flow.async_step_user({"setup_payload": data}))
    assert result["type"] == "create_entry"
    assert flow.unique == "default" and result["data"]["room_prefix"] == ""
    assert result["data"]["setup_revision"] == 1
    assert result["data"]["enable_flag"] == "switch.crop_steering_engine_enabled"
    assert result["data"]["zones"]["2"]["vwc_sensors"] == ["sensor.vwc"]
    states["switch.p"].state = "on"
    result = asyncio.run(flow.async_step_user({"setup_payload": data}))
    assert (
        result["type"] == "abort"
        and "OFF" in result["description_placeholders"]["error"]
    )


def test_new_named_default_is_rejected_to_protect_controller_state(flow_module):
    hass, _, _ = rig()
    flow = flow_module.ConfigFlow()
    flow.hass = hass
    result = asyncio.run(flow.async_step_room({"room_name": "Default"}))
    assert result["type"] == "abort" and result["reason"] == "reserved_room_name"


def test_native_zone_builder_retains_archived_ids_and_unknown_values(flow_module):
    old = {
        "1": {"active": False, "zone_switch": "switch.v1", "special": 123},
        "2": {"zone_switch": "switch.v2", "max_daily_volume": 37},
    }
    result = flow_module._build_zones(1, {"zone_1_switch": "switch.v1"}, old)
    assert result["1"]["active"] is False and result["2"]["active"] is False
    assert result["1"]["special"] == 123 and result["2"]["max_daily_volume"] == 37


def _fields(schema):
    return [
        getattr(marker, "schema", getattr(marker, "key", marker)) for marker in schema
    ]


def test_the_wizard_asks_each_zone_for_its_valve_and_its_substrate_probes_only(
    flow_module,
):
    """A zone needs its valve before anything can water it, and its probes are easiest picked
    here. Its label, plant count, pot size and drippers are the dashboard's Rooms & hardware.
    """
    assert _fields(flow_module._zone_schema(2)) == [
        "zone_1_switch",
        "zone_1_vwc",
        "zone_1_ec",
        "zone_2_switch",
        "zone_2_vwc",
        "zone_2_ec",
    ]


def test_one_valve_for_every_zone_is_asked_once_and_each_zone_for_its_probes(
    flow_module,
):
    """Owner, 2026-10-22: three zones, no valve each, one fertigation valve for all of them."""
    assert _fields(flow_module._zone_schema(2, plumbing="pump_one_valve")) == [
        "shared_valve",
        "zone_1_vwc",
        "zone_1_ec",
        "zone_2_vwc",
        "zone_2_ec",
    ]
    zones = flow_module._build_zones(2, {"shared_valve": "switch.fert"})
    assert [zones[z]["zone_switch"] for z in ("1", "2")] == ["switch.fert"] * 2


def test_configure_offers_the_valve_the_zones_share_and_no_guess_when_they_differ(
    flow_module, monkeypatch
):
    seen = _required_markers(flow_module, monkeypatch)
    flow_module._zone_schema(
        2,
        {"1": {"zone_switch": "switch.fert"}, "2": {"zone_switch": "switch.fert"}},
        "pump_one_valve",
    )
    assert seen["shared_valve"] == {"default": "switch.fert"}
    flow_module._zone_schema(
        2,
        {"1": {"zone_switch": "switch.v1"}, "2": {"zone_switch": "switch.v2"}},
        "pump_one_valve",
    )
    assert seen["shared_valve"] == {}


@pytest.mark.parametrize(
    "plumbing, switches",
    [
        (None, ["pump_switch", "main_line_switch"]),
        ("valves_only", []),
        ("pump_valves", ["pump_switch"]),
        ("mainline_valves", ["main_line_switch"]),
        ("pump_mainline_valves", ["pump_switch", "main_line_switch"]),
        ("pump_one_valve", ["pump_switch"]),
    ],
)
def test_the_last_step_asks_the_switches_the_plumbing_has_and_the_lights_only(
    flow_module, plumbing, switches
):
    """Field capacity and the maximum EC asked here only ever seeded the room's values, which
    every zone's own overrides; pot size and drippers are each zone's, on Rooms & hardware. The
    plumbing is asked with the zone count, so this step asks only for the switches it has.
    """
    assert _fields(flow_module._hardware_schema(plumbing=plumbing)) == [
        *switches,
        "lights_on_hour",
        "lights_off_hour",
    ]


def test_a_zone_archived_on_rooms_and_hardware_is_not_asked_for_and_stays_archived(
    flow_module,
):
    zones = {
        "1": {"zone_switch": "switch.v1"},
        "2": {"zone_switch": "switch.v2", "active": False, "name": "Old bench"},
    }
    assert "zone_2_switch" not in _fields(flow_module._zone_schema(2, zones))
    result = flow_module._build_zones(2, {"zone_1_switch": "switch.v1"}, zones)
    assert result["2"] == zones["2"]  # kept exactly as it was
    assert result["1"]["active"] is True


def test_native_hardware_schema_retains_explicit_mappings(flow_module, monkeypatch):
    mappings = {
        "pump_switch": "switch.pump",
        "main_line_switch": "switch.main",
    }
    defaults = {}
    original = flow_module.vol.Optional

    def optional(key, **kwargs):
        # Prefilled as a SUGGESTED value, not a default: the form still opens showing the
        # existing mapping (so saving cannot wipe it), but the field can now be cleared.
        # With `default=` the frontend dropped an emptied field and voluptuous restored it,
        # so a tank or pump mapping could be swapped but never removed.
        if key in mappings:
            assert "default" not in kwargs, f"{key} can no longer be cleared"
        defaults[key] = (kwargs.get("description") or {}).get("suggested_value")
        return original(key, **kwargs)

    monkeypatch.setattr(flow_module.vol, "Optional", optional)
    schema = flow_module._hardware_schema(mappings)
    fields = {
        getattr(key, "schema", getattr(key, "key", None)): (key, selector)
        for key, selector in schema.items()
    }
    for key, value in mappings.items():
        assert key in fields
        assert defaults[key] == value
    for gone in (
        "tank_ec_sensor",
        "tank_ph_sensor",
        "feed_ec_sensor",
        "feed_ph_sensor",
        "waste_switch",
        "light_entity",
    ):
        assert gone not in fields  # removed in 2.26.0 and (the last two) 1.3.0
    # Nothing ever read the room's temperature, humidity or VPD, or a notification service, and only
    # the tank card showed the tank's water temperature.
    assert not {
        "temperature_sensor",
        "humidity_sensor",
        "vpd_sensor",
        "notification_service",
        "tank_temperature_sensor",
    } & set(fields)
    # The tank's filling status and last fill are the controller's own record of its refills, and
    # its level comes from the reservoir's distance sensor.
    assert not {
        "tank_last_fill_sensor",
        "tank_fill_entity",
        "water_level_sensor",
    } & set(fields)
    hardware = flow_module._build_hardware(mappings)
    assert all(hardware[key] == value for key, value in mappings.items())


# --------------------------------------------------------------------------- the wizard keeps what you typed
# Seen on a first tent install: the last step failed with "switch.gt1_irrigation_switch must read OFF
# before changing setup", the flow ABORTED, and every zone, sensor and sizing entry was gone.
def _wizard(flow_module, *, zones=1):
    hass, _, states = rig()
    hass.config_entries.entries = []
    flow = flow_module.ConfigFlow()
    flow.hass = hass
    # what HA's real flow base class does: prefill the schema with the last submission
    flow.add_suggested_values_to_schema = lambda schema, values: {
        "schema": schema,
        "kept": dict(values),
    }
    flow._data = {
        "name": "Tent",
        "room_name": "Tent",
        "room_prefix": "",
        "room_slug": "default",
        "num_zones": zones,
    }
    return flow, states


ZONE_INPUT = {
    "zone_1_switch": "switch.v1",
    "zone_1_vwc": ["sensor.vwc"],
    "zone_1_ec": ["sensor.ec"],
}


def test_a_valve_that_is_on_is_reported_on_the_zones_step_with_the_input_kept(
    flow_module,
):
    flow, states = _wizard(flow_module)
    states["switch.v1"].state = "on"
    result = asyncio.run(flow.async_step_zones(dict(ZONE_INPUT)))
    assert result["type"] == "form" and result["step_id"] == "zones"
    assert result["data_schema"]["kept"] == ZONE_INPUT  # nothing typed is lost
    assert result["errors"] == {"base": "setup_invalid"}
    assert "switch.v1" in result["description_placeholders"]["error"]
    assert "it is ON" in result["description_placeholders"]["error"]
    states["switch.v1"].state = (
        "off"  # fix the cause, press Submit again: the wizard carries on
    )
    result = asyncio.run(flow.async_step_zones(dict(ZONE_INPUT)))
    assert result["type"] == "form" and result["step_id"] == "hardware"


def test_a_wrong_unit_is_reported_on_the_zones_step_not_three_screens_later(
    flow_module,
):
    flow, states = _wizard(flow_module)
    states["sensor.ec"].attributes["unit_of_measurement"] = "ppm"
    result = asyncio.run(flow.async_step_zones(dict(ZONE_INPUT)))
    assert result["type"] == "form" and result["step_id"] == "zones"
    assert "sensor.ec" in result["description_placeholders"]["error"]


def test_a_failure_on_the_last_step_shows_that_step_again_instead_of_aborting(
    flow_module,
):
    flow, states = _wizard(flow_module)
    asyncio.run(flow.async_step_zones(dict(ZONE_INPUT)))
    hardware = {
        "pump_switch": "switch.p",
        "main_line_switch": "switch.m",
        "lights_on_hour": 6,
    }
    states["switch.p"].state = "unavailable"
    result = asyncio.run(flow.async_step_hardware(dict(hardware)))
    assert result["type"] == "form" and result["step_id"] == "hardware"
    assert result["data_schema"]["kept"] == hardware
    assert "switch.p" in result["description_placeholders"]["error"]
    assert "unavailable" in result["description_placeholders"]["error"]
    assert (
        flow._data["zones"]["1"]["zone_switch"] == "switch.v1"
    )  # earlier steps survive too
    states["switch.p"].state = "off"
    result = asyncio.run(flow.async_step_hardware(dict(hardware)))
    assert result["type"] == "create_entry" and result["data"]["setup_revision"] == 1


def test_a_single_switch_tent_is_a_complete_room(flow_module):
    flow, _states = _wizard(flow_module)
    asyncio.run(flow.async_step_zones(dict(ZONE_INPUT)))
    result = asyncio.run(flow.async_step_hardware({}))  # no pump, no mainline
    assert result["type"] == "create_entry"
    assert (
        result["data"]["hardware"]["pump_switch"] == ""
        and result["data"]["zones"]["1"]["zone_switch"] == "switch.v1"
    )


def test_the_wizard_stores_the_plumbing_answer(flow_module):
    flow, _states = _wizard(flow_module)
    asyncio.run(
        flow.async_step_manual_zones({"num_zones": 1, "plumbing": "valves_only"})
    )
    asyncio.run(flow.async_step_zones(dict(ZONE_INPUT)))
    result = asyncio.run(flow.async_step_hardware({}))
    assert result["type"] == "create_entry"
    assert result["data"]["plumbing"] == "valves_only"


def test_a_pump_layout_without_a_pump_is_caught_on_the_step_that_asks_for_it(
    flow_module,
):
    """The mistake inference could not see: "my room has a pump" with the pump never chosen.
    It used to save, and the controller then watered with the valve open and no pump."""
    flow, _states = _wizard(flow_module)
    asyncio.run(
        flow.async_step_manual_zones({"num_zones": 1, "plumbing": "pump_valves"})
    )
    asyncio.run(flow.async_step_zones(dict(ZONE_INPUT)))
    result = asyncio.run(flow.async_step_hardware({}))
    assert result["type"] == "form" and result["step_id"] == "hardware"
    assert "no pump switch is chosen" in result["description_placeholders"]["error"]
    result = asyncio.run(flow.async_step_hardware({"pump_switch": "switch.p"}))
    assert result["type"] == "create_entry"
    assert result["data"]["plumbing"] == "pump_valves"


def test_a_one_valve_room_maps_its_valve_on_every_zone(flow_module):
    """Owner, 2026-10-22: the main pump and one fertigation valve water all the zones at once."""
    flow, _states = _wizard(flow_module, zones=2)
    form = asyncio.run(
        flow.async_step_manual_zones({"num_zones": 2, "plumbing": "pump_one_valve"})
    )
    assert _fields(form["data_schema"])[0] == "shared_valve"  # asked once, not a zone's
    result = asyncio.run(
        flow.async_step_zones(
            {
                "shared_valve": "switch.v1",
                "zone_1_vwc": ["sensor.vwc"],
                "zone_1_ec": ["sensor.ec"],
                "zone_2_vwc": [],
                "zone_2_ec": [],
            }
        )
    )
    assert result["step_id"] == "hardware"  # no pump yet: that is the next screen's
    assert _fields(result["data_schema"]) == [
        "pump_switch",
        "lights_on_hour",
        "lights_off_hour",
    ]
    result = asyncio.run(flow.async_step_hardware({"pump_switch": "switch.p"}))
    assert result["type"] == "create_entry"
    zones = result["data"]["zones"]
    assert [zones[z]["zone_switch"] for z in ("1", "2")] == ["switch.v1"] * 2
    assert result["data"]["plumbing"] == "pump_one_valve"


def _required_markers(flow_module, monkeypatch):
    """The stub voluptuous forgets whether a marker was required or had a default; record it.
    (tests_ha/ checks the same thing against the real library.)"""
    seen = {}
    original = flow_module.vol.Required

    def required(key, **kwargs):
        seen[key] = kwargs
        return original(key, **kwargs)

    monkeypatch.setattr(flow_module.vol, "Required", required)
    return seen


def test_the_plumbing_question_is_asked_with_the_zone_count_and_a_new_room_gets_no_guess(
    flow_module, monkeypatch
):
    seen = _required_markers(flow_module, monkeypatch)
    schema = flow_module._count_schema(3)
    assert seen["plumbing"] == {}  # required, no default: a newcomer answers it
    # Asked before the zones and the switches it governs.
    assert _fields(schema) == ["num_zones", "plumbing"]
    plumbing = next(
        selector for marker, selector in schema.items() if marker == "plumbing"
    )
    assert plumbing["options"] == [
        "valves_only",
        "pump_valves",
        "mainline_valves",
        "pump_mainline_valves",
        "pump_one_valve",
    ]


def test_configure_prefills_what_the_room_declared_or_what_its_switches_imply(
    flow_module, monkeypatch
):
    seen = _required_markers(flow_module, monkeypatch)
    hass, entry, _states = rig()  # from before the question existed: pump and main-line
    flow = flow_module.OptionsFlowHandler(entry)
    flow.hass = hass
    asyncio.run(flow.async_step_edit_zones())
    assert seen["plumbing"] == {"default": "pump_mainline_valves"}
    entry.data["plumbing"] = "pump_valves"  # a declaration always wins over the guess
    asyncio.run(flow.async_step_edit_zones())
    assert seen["plumbing"] == {"default": "pump_valves"}


def test_a_blocker_says_whether_the_entity_is_on_unreachable_or_missing():
    hass, entry, states = rig()
    states["switch.p"].state = "on"
    states["switch.m"].state = "unavailable"
    del states["switch.v1"]
    found = {line.split(" ")[0]: line for line in api.safety_blockers(hass, entry)}
    assert "it is ON" in found["switch.p"]
    assert "unavailable" in found["switch.m"]
    assert "not found" in found["switch.v1"]
    assert all("must read OFF" in line for line in found.values())


# --------------------------------------------------------------------------- only what is read
def test_a_new_room_records_only_what_something_reads(flow_module):
    flow, _states = _wizard(flow_module)
    asyncio.run(flow.async_step_zones(dict(ZONE_INPUT)))
    result = asyncio.run(
        flow.async_step_hardware(
            {"plumbing": "valves_only", "lights_on_hour": 6, "lights_off_hour": 18}
        )
    )
    data = result["data"]
    # Nothing ever read these: the features switches are their own entities now, and how a room
    # was set up changes nothing.
    assert not {"features", "installation_mode", "config_method"} & set(data)
    # Its number entities start from their defaults, which are what the form used to offer.
    assert data["parameters"] == {"lights_on_hour": 6, "lights_off_hour": 18}
    zone = data["zones"]["1"]
    assert zone["name"] == "Zone 1" and zone["active"] is True
    assert zone["plant_count"] == 4  # set on Rooms & hardware
    assert zone["vwc_sensors"] == ["sensor.vwc"] and zone["ec_sensors"] == ["sensor.ec"]


def test_configure_keeps_what_rooms_and_hardware_set(flow_module):
    """Configure asks a zone only for its valve and probes. Its label, plant count, sizing and
    daily limit come from Rooms & hardware, and a save here must not reset them to defaults (the
    form used to refill a field it did not ask with one)."""
    hass, entry, _states = rig()
    entry.data["zones"]["1"].update(
        name="Front bench",
        plant_count=12,
        substrate_volume=6.0,
        drippers_per_plant=2,
        dripper_flow_rate=2.0,
        max_daily_volume=37,
    )
    entry.data["parameters"] = {"substrate_volume": 10.0, "lights_on_hour": 6}
    flow = flow_module.OptionsFlowHandler(entry)
    flow.hass = hass
    flow._edit_num = 2
    result = asyncio.run(
        flow.async_step_edit_zones_map(
            {
                "plumbing": "pump_mainline_valves",
                "pump_switch": "switch.p",
                "main_line_switch": "switch.m",
                "zone_1_switch": "switch.v1",
                "zone_1_vwc": ["sensor.vwc"],
                "zone_1_ec": [],
                "zone_2_switch": "switch.v2",
                "lights_on_hour": 7,
                "lights_off_hour": 19,
            }
        )
    )
    assert result["type"] == "create_entry"
    zone = entry.data["zones"]["1"]
    assert zone["name"] == "Front bench" and zone["plant_count"] == 12
    assert (zone["substrate_volume"], zone["drippers_per_plant"]) == (6.0, 2)
    assert (zone["dripper_flow_rate"], zone["max_daily_volume"]) == (2.0, 37)
    assert zone["special"] == 123 and zone["vwc_sensors"] == ["sensor.vwc"]
    assert entry.data["zones"]["2"]["plant_count"] == 8
    assert entry.data["parameters"] == {
        "substrate_volume": 10.0,
        "lights_on_hour": 7,
        "lights_off_hour": 19,
    }


def test_configure_points_to_the_dashboard_for_everything_else(flow_module):
    hass, entry, _states = rig()
    flow = flow_module.OptionsFlowHandler(entry)
    flow.hass = hass
    assert not hasattr(flow, "async_step_edit_parameters")
    result = asyncio.run(flow.async_step_open_dashboard())
    assert result == {"type": "abort", "reason": "use_dashboard"}
