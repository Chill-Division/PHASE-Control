"""Setup lifecycle safety and stable-ID compatibility, without live Home Assistant."""

import asyncio
from types import SimpleNamespace

import pytest

from custom_components.crop_steering import setup_api as api


class Entries:
    def __init__(self, entries):
        self.entries = entries
        self.updates = []

    def async_entries(self, domain):
        return self.entries

    def async_update_entry(self, entry, **kwargs):
        self.updates.append(kwargs)
        for key, value in kwargs.items():
            setattr(entry, key, value)


def rig():
    entry = SimpleNamespace(
        entry_id="one",
        title="Veg",
        options={},
        data={
            "room_name": "Veg",
            "room_slug": "veg",
            "room_prefix": "veg_",
            "num_zones": 2,
            "zones": {
                "1": {"zone_switch": "switch.v1", "plant_count": 4, "special": 123},
                "2": {"zone_switch": "switch.v2", "plant_count": 8},
            },
            "hardware": {"pump_switch": "switch.p", "main_line_switch": "switch.m"},
            "parameters": {"p2_vwc_threshold": 47},
        },
    )
    states = {}
    for eid in [
        "switch.v1",
        "switch.v2",
        "switch.v3",
        "switch.p",
        "switch.m",
        "switch.crop_steering_veg_engine_enabled",
    ]:
        states[eid] = SimpleNamespace(entity_id=eid, state="off", attributes={})
    for eid, unit in [
        ("sensor.vwc", "%"),
        ("sensor.ec", "mS/cm"),
        ("sensor.temp", "°C"),
    ]:
        states[eid] = SimpleNamespace(
            entity_id=eid, state="50", attributes={"unit_of_measurement": unit}
        )

    async def in_executor(function, *args):  # what Home Assistant always has
        return function(*args)

    hass = SimpleNamespace(
        config_entries=Entries([entry]),
        data={},
        states=SimpleNamespace(get=states.get, async_all=lambda: list(states.values())),
        async_add_executor_job=in_executor,
    )
    return hass, entry, states


def payload():
    return {
        "entry_id": "one",
        "expected_revision": 0,
        "room_name": "Veg renamed",
        "active": True,
        "zones": [
            {
                "id": 1,
                "name": "Front",
                "active": False,
                "valve": "switch.v1",
                "vwc_sensors": [],
                "ec_sensors": [],
                "plant_count": 4,
            },
            {
                "id": 2,
                "name": "Rear",
                "active": True,
                "valve": "switch.v2",
                "vwc_sensors": ["sensor.vwc"],
                "ec_sensors": ["sensor.ec"],
                "plant_count": 8,
            },
        ],
        "hardware": {"pump_switch": "switch.p", "main_line_switch": "switch.m"},
    }


def test_setup_preserves_identity_and_metadata_when_archiving_middle_zone():
    hass, entry, _ = rig()
    result = asyncio.run(api.save_setup(hass, payload()))
    assert result["entry_id"] == "one" and result["revision"] == 1
    assert result["active_zone_ids"] == [2]
    assert entry.data["room_prefix"] == "veg_"
    assert entry.data["zones"]["1"]["special"] == 123
    assert entry.data["zones"]["2"]["plant_count"] == 8
    assert entry.data["parameters"]["p2_vwc_threshold"] == 47


@pytest.mark.parametrize(
    "entity,state",
    [
        ("switch.p", "on"),
        ("switch.m", "unavailable"),
        ("switch.crop_steering_veg_engine_enabled", "on"),
        ("switch.v1", "unknown"),
    ],
)
def test_setup_rejects_unsafe_hardware_or_armed_engine(entity, state):
    hass, _, states = rig()
    states[entity].state = state
    with pytest.raises(ValueError, match="OFF"):
        asyncio.run(api.save_setup(hass, payload()))
    assert not hass.config_entries.updates


def test_setup_rejects_revision_and_wrong_units_before_writes():
    hass, _, _ = rig()
    data = payload()
    data["expected_revision"] = 5
    with pytest.raises(ValueError, match="changed"):
        asyncio.run(api.save_setup(hass, data))
    data = payload()
    data["zones"][1]["vwc_sensors"] = ["sensor.temp"]
    with pytest.raises(ValueError, match="unit"):
        asyncio.run(api.save_setup(hass, data))
    assert not hass.config_entries.updates


def test_setup_rejects_duplicate_valves_across_rooms():
    hass, _, _ = rig()
    hass.config_entries.entries.append(
        SimpleNamespace(
            entry_id="other",
            options={},
            data={
                "room_prefix": "other_",
                "zones": {"1": {"zone_switch": "switch.v2"}},
                "num_zones": 1,
            },
        )
    )
    with pytest.raises(ValueError, match="allocated"):
        asyncio.run(api.save_setup(hass, payload()))


def test_room_archive_requires_exact_selection_and_is_reversible():
    hass, entry, _ = rig()
    with pytest.raises(ValueError, match="name"):
        asyncio.run(
            api.remove_setup(
                hass,
                {"entry_id": "one", "expected_revision": 0, "confirm_name": "wrong"},
            )
        )
    result = asyncio.run(
        api.remove_setup(
            hass, {"entry_id": "one", "expected_revision": 0, "confirm_name": "Veg"}
        )
    )
    assert result["archived"] and entry.data["active"] is False
    assert set(entry.data["zones"]) == {"1", "2"}
    data = payload()
    data["expected_revision"] = 1
    asyncio.run(api.save_setup(hass, data))
    assert entry.data["active"] is True


def test_setup_new_ids_append_and_existing_ids_cannot_disappear():
    hass, _, _ = rig()
    data = payload()
    data["zones"] = data["zones"][1:]
    with pytest.raises(ValueError, match="archive"):
        asyncio.run(api.save_setup(hass, data))
    data = payload()
    data["zones"].append(
        {"id": 4, "name": "skip", "active": True, "valve": "switch.v3"}
    )
    with pytest.raises(ValueError, match="sequential"):
        asyncio.run(api.save_setup(hass, data))


@pytest.mark.parametrize("role", ["pump_is_foreign_valve", "valve_is_foreign_pump"])
def test_shared_hardware_cannot_conflict_with_a_zone_role(role):
    hass, _, states = rig()
    data = payload()
    foreign = {"room_prefix": "other_", "num_zones": 1, "zones": {}, "hardware": {}}
    if role == "pump_is_foreign_valve":
        foreign["zones"] = {"1": {"zone_switch": "switch.p"}}
    else:
        foreign["hardware"] = {"pump_switch": "switch.v2"}
    hass.config_entries.entries.append(
        SimpleNamespace(entry_id="other", data=foreign, options={})
    )
    states["switch.crop_steering_other_engine_enabled"] = SimpleNamespace(
        state="off", attributes={}
    )
    with pytest.raises(ValueError, match="role"):
        asyncio.run(api.save_setup(hass, data))
    assert not hass.config_entries.updates


def switch_free():
    """The room as it is, renamed, its zones named, a probe and the tank's sensor mapped: nothing
    the controller switches is different."""
    return {
        "entry_id": "one",
        "expected_revision": 0,
        "room_name": "GT4",
        "active": True,
        "zones": [
            {
                "id": 1,
                "name": "Bench",
                "active": True,
                "valve": "switch.v1",
                "vwc_sensors": ["sensor.vwc"],
                "ec_sensors": ["sensor.ec"],
                "plant_count": 4,
            },
            {
                "id": 2,
                "name": "Rear",
                "active": True,
                "valve": "switch.v2",
                "vwc_sensors": [],
                "ec_sensors": [],
                "plant_count": 8,
            },
        ],
        "hardware": {"pump_switch": "switch.p", "main_line_switch": "switch.m"},
    }


def test_a_change_that_switches_nothing_differently_saves_with_watering_on():
    """GT4, 2026-10-19: mapping the tank's distance sensor meant watering off to save, and the
    controller then held the room because watering went straight back on."""
    hass, entry, states = rig()
    states["switch.crop_steering_veg_engine_enabled"].state = "on"
    # A shot under way: the controller waits for it, the save need not.
    states["switch.p"].state = "on"
    result = asyncio.run(api.save_setup(hass, switch_free()))
    assert result["revision"] == 1 and entry.data["room_name"] == "GT4"
    assert entry.data["zones"]["1"]["vwc_sensors"] == ["sensor.vwc"]


@pytest.mark.parametrize(
    "change",
    [
        lambda p: p["zones"][0].update(valve="switch.v3"),  # a valve
        lambda p: p["zones"][0].update(active=False),  # a zone out of use
        lambda p: p["hardware"].update(pump_switch=""),  # the pump
        # another plumbing: the pump without its main line
        lambda p: (
            p.update(plumbing="pump_valves"),
            p["hardware"].update(main_line_switch=""),
        ),
    ],
)
def test_a_change_that_switches_something_differently_still_needs_watering_off(change):
    hass, _, states = rig()
    states["switch.crop_steering_veg_engine_enabled"].state = "on"
    data = switch_free()
    change(data)
    with pytest.raises(ValueError, match="engine_enabled must read OFF"):
        asyncio.run(api.save_setup(hass, data))
    assert not hass.config_entries.updates


def test_declaring_the_plumbing_the_switches_imply_is_not_a_switch_change():
    hass, entry, states = rig()
    states["switch.crop_steering_veg_engine_enabled"].state = "on"
    data = switch_free()
    # What switch.p and switch.m already imply.
    data["plumbing"] = "pump_mainline_valves"
    asyncio.run(api.save_setup(hass, data))
    assert entry.data["plumbing"] == "pump_mainline_valves"


def test_the_switch_map_ignores_sensors_names_and_sizes():
    before = {
        "num_zones": 1,
        "hardware": {"pump_switch": "switch.p"},
        "zones": {"1": {"zone_switch": "switch.v1", "name": "A", "vwc_sensors": []}},
    }
    after = {
        "num_zones": 1,
        "room_name": "GT4",
        "hardware": {
            "pump_switch": "switch.p",
            "reservoir_distance_sensor": "sensor.d",
        },
        "zones": {
            1: {
                "zone_switch": "switch.v1",
                "name": "B",
                "plant_count": 6,
                "vwc_sensors": ["sensor.vwc"],
            }
        },
    }
    assert api.switch_map(before) == api.switch_map(after)
    after["hardware"]["fresh_water_switch"] = "switch.fresh"
    assert api.switch_map(before) != api.switch_map(after)


def test_shared_room_must_be_disarmed_even_when_owner_is_off():
    hass, _, states = rig()
    hass.config_entries.entries.append(
        SimpleNamespace(
            entry_id="other",
            options={},
            data={
                "room_prefix": "other_",
                "num_zones": 1,
                "zones": {},
                "hardware": {"pump_switch": "switch.p"},
            },
        )
    )
    states["switch.crop_steering_other_engine_enabled"] = SimpleNamespace(
        state="on", attributes={}
    )
    with pytest.raises(ValueError, match="other_engine_enabled.*OFF"):
        asyncio.run(api.save_setup(hass, payload()))


def test_options_shadow_is_removed_and_unrelated_option_preserved():
    hass, entry, _ = rig()
    entry.options = {"zones": entry.data["zones"], "future_option": 42}
    asyncio.run(api.save_setup(hass, payload()))
    assert "zones" not in entry.options
    assert entry.options["future_option"] == 42
    assert api.effective(entry)["future_option"] == 42
    assert api.effective(entry)["zones"]["1"]["active"] is False


def test_archiving_zone_does_not_require_a_removed_moisture_probe():
    hass, entry, _ = rig()
    entry.data["zones"]["1"]["vwc_sensors"] = ["sensor.deleted"]
    data = payload()
    data["zones"][0]["vwc_sensors"] = ["sensor.deleted"]
    result = asyncio.run(api.save_setup(hass, data))
    assert result["active_zone_ids"] == [2]
    assert entry.data["zones"]["1"]["vwc_sensors"] == ["sensor.deleted"]


def test_setup_reads_current_hydraulics_before_legacy_defaults_and_preserves_rename():
    hass, entry, states = rig()
    entry.data["parameters"].update(
        substrate_volume=9, dripper_flow_rate=1.2, drippers_per_plant=3
    )
    values = {"substrate_volume": 6.75, "dripper_flow_rate": 4, "drippers_per_plant": 1}
    for key, value in values.items():
        eid = f"number.crop_steering_veg_{key}"
        states[eid] = SimpleNamespace(entity_id=eid, state=str(value), attributes={})
    eid = "number.crop_steering_veg_zone_1_plant_count"
    states[eid] = SimpleNamespace(entity_id=eid, state="42", attributes={})
    # A different room and an orphan must never win room-scoped resolution.
    states["number.crop_steering_zone_1_plant_count"] = SimpleNamespace(
        state="7", attributes={}
    )
    states[eid + "_2"] = SimpleNamespace(state="99", attributes={})
    current = api.setup_room(hass, entry)
    assert {key: current["zones"][0][key] for key in api.SIZING} == {
        **values,
        "plant_count": 42,
    }
    current["room_name"] = "Renamed"
    current["expected_revision"] = current["revision"]
    asyncio.run(api.save_setup(hass, current))
    assert {key: entry.data["zones"]["1"][key] for key in api.SIZING} == {
        **values,
        "plant_count": 42,
    }


def test_setup_hydraulics_prefer_zone_and_reject_invalid_live_values():
    hass, entry, states = rig()
    for key, value in {
        "substrate_volume": 8,
        "plant_count": 21,
        "dripper_flow_rate": 3,
        "drippers_per_plant": 2,
    }.items():
        eid = f"number.crop_steering_veg_zone_1_{key}"
        states[eid] = SimpleNamespace(entity_id=eid, state=str(value), attributes={})
    assert api.setup_room(hass, entry)["zones"][0]["substrate_volume"] == 8
    for invalid in ["nan", "inf", "unavailable", "0", "1.5"]:
        states["number.crop_steering_veg_zone_1_plant_count"].state = invalid
        assert api.setup_room(hass, entry)["zones"][0]["plant_count"] == 4


def test_setup_response_shows_explicit_new_sizing_until_entity_reload():
    hass, entry, states = rig()
    eid = "number.crop_steering_veg_zone_1_plant_count"
    states[eid] = SimpleNamespace(entity_id=eid, state="42", attributes={})
    data = payload()
    data["zones"][0]["plant_count"] = 36
    saved = asyncio.run(api.save_setup(hass, data))
    assert saved["zones"][0]["plant_count"] == 36
    states[eid] = SimpleNamespace(
        entity_id=eid, state="38", attributes={"setup_revision": 1, "setup_value": 36}
    )
    assert api.setup_room(hass, entry)["zones"][0]["plant_count"] == 38


def test_setup_accepts_probe_units_it_can_convert_exactly_and_explains_the_ones_it_cannot():
    hass, entry, states = rig()
    data = payload()
    states["sensor.ec"].attributes["unit_of_measurement"] = "µS/cm"
    states["sensor.vwc"].attributes["unit_of_measurement"] = "m³/m³"
    assert api.prepare_setup(hass, data, entry.data, "one")["zones"]["2"][
        "ec_sensors"
    ] == ["sensor.ec"]
    states["sensor.ec"].attributes["unit_of_measurement"] = "ppm"
    with pytest.raises(ValueError, match="500 or 700 scale"):
        api.prepare_setup(hass, data, entry.data, "one")
    states["sensor.ec"].attributes["unit_of_measurement"] = "bananas"
    with pytest.raises(ValueError, match="accepted: .*ms/cm"):
        api.prepare_setup(hass, data, entry.data, "one")


def one_valve(*valves):
    """The room with one valve for all its zones: the pump, then switch.v1 waters both zones."""
    data = switch_free()
    data["plumbing"] = "pump_one_valve"
    data["hardware"] = {"pump_switch": "switch.p", "main_line_switch": ""}
    for row, valve in zip(data["zones"], valves or ("switch.v1", "switch.v1")):
        row["valve"] = valve
    return data


def test_a_one_valve_room_maps_its_one_valve_on_every_zone():
    """Owner, 2026-10-22: the main pump and one fertigation valve water all the zones at once."""
    hass, entry, _ = rig()
    asyncio.run(api.save_setup(hass, one_valve()))
    assert entry.data["plumbing"] == "pump_one_valve"
    assert {z["zone_switch"] for z in entry.data["zones"].values()} == {"switch.v1"}


def test_a_one_valve_room_refuses_a_zone_on_another_valve():
    hass, entry, _ = rig()
    with pytest.raises(ValueError, match="every zone uses that one valve"):
        asyncio.run(api.save_setup(hass, one_valve("switch.v1", "switch.v2")))
    assert "plumbing" not in entry.data


def test_a_room_with_a_valve_each_still_refuses_two_zones_on_one():
    hass, _, _ = rig()
    data = one_valve()
    data["plumbing"] = "pump_valves"
    with pytest.raises(ValueError, match="already allocated"):
        asyncio.run(api.save_setup(hass, data))


def test_another_room_cannot_use_a_one_valve_rooms_valve():
    hass, _, _ = rig()
    hass.config_entries.entries.append(
        SimpleNamespace(
            entry_id="other",
            options={},
            data={
                "room_prefix": "other_",
                "zones": {"1": {"zone_switch": "switch.v1"}},
                "num_zones": 1,
            },
        )
    )
    with pytest.raises(ValueError, match="allocated"):
        asyncio.run(api.save_setup(hass, one_valve()))
