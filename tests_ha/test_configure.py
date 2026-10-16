"""Configure (the options flow), in a real Home Assistant.

It edits a room's zones, plumbing and lights hours; everything else is on the dashboard. Two
things an operator reaches for after the first install did nothing: editing a parameter (saved,
reloaded, and the entity restored its old value over the top) and removing a mapping (the form put
it straight back). In 1.3.0 the parameters screen went, with the pot size, drippers, field capacity
and maximum EC the zones form showed: what they saved never reached anything the controller reads.
"""

import pytest
from homeassistant.core import Context
from homeassistant.data_entry_flow import FlowResultType

from test_real_flow import VALVE
from test_setup_entry import _install
from test_upgrade_in_place import _upgrade


async def _open(hass, entry, step):
    flow = await hass.config_entries.options.async_init(entry.entry_id)
    assert flow["type"] is FlowResultType.MENU and step in flow["menu_options"]
    return await hass.config_entries.options.async_configure(
        flow["flow_id"], {"next_step_id": step}
    )


def _shown(flow):
    return {
        str(marker): marker.default()
        for marker in flow["data_schema"].schema
        if callable(getattr(marker, "default", None))
    }


def _numbers(hass):
    return {s.entity_id: float(s.state) for s in hass.states.async_all("number")}


# ------------------------------------------------------------------ what Configure offers
async def test_configure_edits_zones_plumbing_and_lights_and_says_where_the_rest_is(hass):
    entry = await _install(hass)
    flow = await hass.config_entries.options.async_init(entry.entry_id)
    assert flow["type"] is FlowResultType.MENU
    assert flow["menu_options"] == ["edit_zones", "open_dashboard"]
    before = _numbers(hass)
    done = await hass.config_entries.options.async_configure(
        flow["flow_id"], {"next_step_id": "open_dashboard"}
    )
    assert done["type"] is FlowResultType.ABORT and done["reason"] == "use_dashboard"
    assert _numbers(hass) == before  # it only says where; nothing is written


async def test_the_zones_form_asks_only_valves_probes_plumbing_and_lights(hass):
    entry = await _install(hass)
    flow = await _open(hass, entry, "edit_zones")
    flow = await hass.config_entries.options.async_configure(flow["flow_id"], {"num_zones": 1})
    asked = [str(marker) for marker in flow["data_schema"].schema]
    assert asked == [
        "zone_1_switch",
        "zone_1_vwc",
        "zone_1_ec",
        "plumbing",
        "pump_switch",
        "main_line_switch",
        "lights_on_hour",
        "lights_off_hour",
    ]


async def _service(hass, admin, name, data=None):
    return await hass.services.async_call(
        "crop_steering",
        name,
        data or {},
        blocking=True,
        return_response=True,
        context=Context(user_id=admin.id),
    )


async def test_a_save_keeps_what_rooms_and_hardware_set(hass, hass_admin_user):
    """The form refilled every field it did not ask with a default: a save here would have reset
    a zone's plant count to 4 and its sizing, and a cleared EC probe list would have stayed lost.
    A zone's name, plants and sizing are Rooms & hardware's, and a save here keeps them."""
    entry = await _install(hass)
    (room,) = (await _service(hass, hass_admin_user, "setup_read"))["rooms"]
    zone = dict(room["zones"][0])
    zone.update(
        name="Front bench",
        plant_count=12,
        substrate_volume=6.0,
        drippers_per_plant=2,
        dripper_flow_rate=2.0,
    )
    await _service(
        hass,
        hass_admin_user,
        "setup_save",
        {
            "entry_id": room["entry_id"],
            "expected_revision": room["revision"],
            "room_name": room["room_name"],
            "active": room["active"],
            **({"plumbing": room["plumbing"]} if room.get("plumbing") else {}),
            "hardware": dict(room["hardware"]),
            "zones": [zone],
        },
    )
    await hass.async_block_till_done()
    numbers = _numbers(hass)
    assert numbers["number.crop_steering_zone_1_plant_count"] == 12
    assert numbers["number.crop_steering_zone_1_substrate_volume"] == 6.0
    saved = dict(entry.data["zones"]["1"])

    await _save_map(hass, entry)  # untouched, as an operator who only looked would save it

    kept = entry.data["zones"]["1"]
    for key in ("name", "plant_count", "substrate_volume", "drippers_per_plant",
                "dripper_flow_rate", "max_daily_volume", "ec_sensors", "vwc_sensors"):
        assert kept.get(key) == saved.get(key), key
    assert _numbers(hass) == numbers  # every number the room has, the zone's included


@pytest.mark.parametrize(
    "name", ["entry_2_18_one_switch_tent.json", "entry_2_17_wizard.json", "entry_env_era.json"]
)
async def test_an_upgraded_rooms_untouched_save_moves_nothing(hass, name):
    """In-place upgrade: the same form on rooms as OLD versions left them (tests_ha/fixtures)."""
    hass.states.async_set("input_boolean.f2_control_enabled", "off")  # an env-era room's kill switch
    entry, seed = await _upgrade(hass, name)
    ec = hass.states.get("sensor.veg_ec_template")
    if ec is not None:  # the env-era room's EC template reports no unit, which the form refuses
        hass.states.async_set(
            ec.entity_id, ec.state, {**ec.attributes, "unit_of_measurement": "mS/cm"}
        )
    before = _numbers(hass)
    await _save_map(hass, entry, zones=int(entry.data["num_zones"]))
    assert _numbers(hass) == before  # every number this room has
    for zone_id, old in seed["data"].get("zones", {}).items():
        new = entry.data["zones"][zone_id]
        for key in ("name", "plant_count", "max_daily_volume", "zone_switch"):
            if key in old:
                assert new.get(key) == old[key], (zone_id, key)
    # What it recorded at setup stays; the lights hours are saved as the live ones (below).
    for key, value in seed["data"].get("parameters", {}).items():
        if key not in ("lights_on_hour", "lights_off_hour"):
            assert entry.data["parameters"].get(key) == value, key


# ------------------------------------------------------------------ removing a mapping
async def _save_map(hass, entry, zones=1, **hardware):
    flow = await _open(hass, entry, "edit_zones")
    flow = await hass.config_entries.options.async_configure(
        flow["flow_id"], {"num_zones": zones}
    )
    assert flow["step_id"] == "edit_zones_map"
    # What the frontend sends: every field at the value it is showing, plus the change.
    answers = {**_shown(flow), **_suggested(flow), **hardware}
    for key, value in hardware.items():
        if value is None:  # the operator CLEARED this field: the frontend omits the key
            answers.pop(key)
    done = await hass.config_entries.options.async_configure(flow["flow_id"], answers)
    assert done["type"] is FlowResultType.CREATE_ENTRY, done.get("errors")
    await hass.async_block_till_done()
    return flow


def _suggested(flow):
    return {
        str(marker): marker.description["suggested_value"]
        for marker in flow["data_schema"].schema
        if (getattr(marker, "description", None) or {}).get("suggested_value")
        not in (None, "", [])
    }


async def test_an_untouched_save_keeps_every_mapping(hass):
    hass.states.async_set("switch.pump", "off")
    entry = await _install(hass, {"pump_switch": "switch.pump"})
    before = dict(entry.data["hardware"])
    flow = await _save_map(hass, entry)
    # The form opened showing the mapping, so an untouched save could not have wiped it.
    assert _suggested(flow)["pump_switch"] == "switch.pump"
    assert entry.data["hardware"] == before


async def test_a_waste_valve_and_lights_an_older_room_recorded_go_on_its_next_save(hass):
    """1.3.0: nothing ever drove a waste valve or read the room's lights (day and night come from
    the lights hours), so the form no longer asks for them, and a room that recorded them loses
    them the next time its zones and hardware are saved."""
    entry = await _install(hass)
    hass.config_entries.async_update_entry(
        entry,
        data={
            **entry.data,
            "hardware": {
                **entry.data["hardware"],
                "waste_switch": "switch.waste",
                "light_entity": "light.room",
            },
        },
    )
    flow = await _save_map(hass, entry)
    asked = {str(marker) for marker in flow["data_schema"].schema}
    assert not {"waste_switch", "light_entity"} & asked
    assert not {"waste_switch", "light_entity"} & set(entry.data["hardware"])


async def test_a_pump_can_be_removed_by_saying_the_room_no_longer_has_one(hass):
    hass.states.async_set("switch.pump", "off")
    entry = await _install(hass, {"pump_switch": "switch.pump"})
    assert entry.data["hardware"]["pump_switch"] == "switch.pump"
    assert entry.data["plumbing"] == "pump_valves"
    await _save_map(hass, entry, pump_switch=None, plumbing="valves_only")
    assert entry.data["hardware"]["pump_switch"] == ""
    assert entry.data["plumbing"] == "valves_only"


async def test_clearing_the_pump_of_a_room_that_says_it_has_one_is_refused_in_the_form(hass):
    """The defect this feature exists for. On 2.18.0 this save went through, and the controller
    then opened the valve with no pump running and counted the water as delivered."""
    hass.states.async_set("switch.pump", "off")
    entry = await _install(hass, {"pump_switch": "switch.pump"})
    revision = entry.data["setup_revision"]
    flow = await _open(hass, entry, "edit_zones")
    flow = await hass.config_entries.options.async_configure(flow["flow_id"], {"num_zones": 1})
    answers = {**_shown(flow), **_suggested(flow)}
    answers.pop("pump_switch")  # cleared in the form; the layout still says "a pump, then zone valves"
    result = await hass.config_entries.options.async_configure(flow["flow_id"], answers)
    assert result["type"] is FlowResultType.FORM and result["step_id"] == "edit_zones_map"
    assert "no pump switch is chosen" in result["description_placeholders"]["error"]
    assert entry.data["hardware"]["pump_switch"] == "switch.pump"  # nothing was written
    assert entry.data["setup_revision"] == revision


async def test_a_save_while_a_switch_is_on_is_refused_and_nothing_is_written(hass):
    """As the parameters screen refused one: a mapping is changed only with everything off."""
    entry = await _install(hass)
    revision = entry.data["setup_revision"]
    hass.states.async_set(VALVE, "on")
    flow = await _open(hass, entry, "edit_zones")
    flow = await hass.config_entries.options.async_configure(flow["flow_id"], {"num_zones": 1})
    result = await hass.config_entries.options.async_configure(
        flow["flow_id"], {**_shown(flow), **_suggested(flow)}
    )
    assert result["type"] is FlowResultType.FORM and result["step_id"] == "edit_zones_map"
    assert VALVE in result["description_placeholders"]["error"]
    assert entry.data["setup_revision"] == revision


# ------------------------------------------------------------------ the lights hours
# The controller reads the lights hours from these two numbers every loop. The zones-and-hardware
# form showed, and saved, the hours recorded at setup, which only seed them once: a room ran its
# lights 20-7 while this form said 7-20, and saving 7-20 here changed nothing the controller read.
LIGHTS = ("number.crop_steering_lights_on_hour", "number.crop_steering_lights_off_hour")


async def _set_lights(hass, on, off):
    for entity_id, hour in zip(LIGHTS, (on, off)):
        await hass.services.async_call(
            "number", "set_value", {"entity_id": entity_id, "value": hour}, blocking=True
        )


def _lights(hass):
    return tuple(float(hass.states.get(entity_id).state) for entity_id in LIGHTS)


async def test_the_lights_hours_open_on_the_live_ones_and_a_save_reaches_the_controller(hass):
    entry = await _install(hass)
    await _set_lights(hass, 20, 7)  # what the controller runs on, whatever setup recorded
    flow = await _save_map(hass, entry, lights_on_hour=7, lights_off_hour=20)
    shown = _shown(flow)
    assert (shown["lights_on_hour"], shown["lights_off_hour"]) == (20, 7)
    assert _lights(hass) == (7.0, 20.0)
    params = entry.data["parameters"]
    assert (params["lights_on_hour"], params["lights_off_hour"]) == (7, 20)


async def test_an_untouched_save_keeps_the_lights_hours_changed_since_setup(hass):
    entry = await _install(hass)
    await _set_lights(hass, 18, 6)  # changed on a dashboard since setup
    await _save_map(hass, entry)
    assert _lights(hass) == (18.0, 6.0)


@pytest.mark.parametrize(
    "name", ["entry_2_18_one_switch_tent.json", "entry_2_17_wizard.json", "entry_env_era.json"]
)
async def test_an_upgraded_room_keeps_its_lights_hours_until_configure_changes_them(hass, name):
    """In-place upgrade: the update itself moves no hours; the form shows them and saves them."""
    hass.states.async_set("input_boolean.f2_control_enabled", "off")  # an env-era room's kill switch
    entry, _ = await _upgrade(hass, name)
    ec = hass.states.get("sensor.veg_ec_template")
    if ec is not None:  # the env-era room's EC template reports no unit, which the form refuses
        hass.states.async_set(ec.entity_id, ec.state, {**ec.attributes, "unit_of_measurement": "mS/cm"})
    await _set_lights(hass, 20, 7)
    zones = int(entry.data["num_zones"])
    flow = await _save_map(hass, entry, zones=zones)
    assert (_shown(flow)["lights_on_hour"], _shown(flow)["lights_off_hour"]) == (20, 7)
    assert _lights(hass) == (20.0, 7.0)  # an untouched save leaves them where they are
    await _save_map(hass, entry, zones=zones, lights_on_hour=7, lights_off_hour=20)
    assert _lights(hass) == (7.0, 20.0)

