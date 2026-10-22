"""A room whose one valve, after the pump, waters every zone at once, in a real Home Assistant with
the real controller at the far end.

Owner, 2026-10-22: the main pump and one fertigation valve water three zones. The wizard asks the
plumbing with the zone count, then that one valve on the zones' screen; Rooms & hardware keeps it on
every zone; the descriptor publishes it; and the real controller fires one shot for all the zones,
counted on each of them.
"""

import pytest
from conftest import switch_calls
from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.exceptions import HomeAssistantError
from test_configure import _service
from test_real_flow import DOMAIN
from test_upgrade_in_place import DESCRIPTOR

KILL = "switch.crop_steering_engine_enabled"
PUMP = "switch.tent_pump"
VALVE = "switch.fertigation"
ZONES = (1, 2)


async def _install(hass):
    for switch in (PUMP, VALVE, "switch.other_valve"):
        hass.states.async_set(switch, "off")
    for zone in ZONES:
        hass.states.async_set(f"sensor.gt_vwc_{zone}", "41", {"unit_of_measurement": "%"})
        hass.states.async_set(f"sensor.gt_ec_{zone}", "3100", {"unit_of_measurement": "µS/cm"})
    flow = hass.config_entries.flow
    result = await flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    result = await flow.async_configure(result["flow_id"], {"name": "GT1"})
    result = await flow.async_configure(
        result["flow_id"], {"num_zones": 2, "plumbing": "pump_one_valve"}
    )
    assert result["step_id"] == "zones"
    assert [str(m) for m in result["data_schema"].schema] == [
        "shared_valve", "zone_1_vwc", "zone_1_ec", "zone_2_vwc", "zone_2_ec"]  # fmt: skip
    result = await flow.async_configure(
        result["flow_id"],
        {
            "shared_valve": VALVE,
            **{f"zone_{z}_vwc": [f"sensor.gt_vwc_{z}"] for z in ZONES},
            **{f"zone_{z}_ec": [f"sensor.gt_ec_{z}"] for z in ZONES},
        },
    )
    assert result["step_id"] == "hardware", result.get("errors")
    assert [str(m) for m in result["data_schema"].schema] == [
        "pump_switch", "lights_on_hour", "lights_off_hour"]  # fmt: skip
    result = await flow.async_configure(result["flow_id"], {"pump_switch": PUMP})
    assert result["type"] is FlowResultType.CREATE_ENTRY, result
    await hass.async_block_till_done()
    return result["result"]


async def test_the_wizard_maps_the_one_valve_on_every_zone_and_publishes_it(hass):
    entry = await _install(hass)
    assert {zone["zone_switch"] for zone in entry.data["zones"].values()} == {VALVE}
    assert entry.data["plumbing"] == "pump_one_valve"
    descriptor = hass.states.get(DESCRIPTOR).attributes
    assert (descriptor["plumbing"], descriptor["pump"]) == ("pump_one_valve", PUMP)
    assert sorted(map(str, descriptor["valves"])) == ["1", "2"]
    assert set(descriptor["valves"].values()) == {VALVE}


async def test_the_real_controller_waters_every_zone_with_one_shot(hass, controller_for):
    await _install(hass)
    c, fake, _clock = controller_for({"enable_flag": KILL})
    room = c.rooms[0]
    assert room.hw["plumbing"] == "pump_one_valve" and c._valve_group(room) == [1, 2]
    for switch in (KILL, *(f"switch.crop_steering_zone_{z}_enabled" for z in ZONES)):
        fake.set_state(switch, "on")
    assert c._blocked(room, 1) is None
    fake.calls.clear()
    c._execute_shot(room, 1, 30, 5, flow_lps=c._zone_flow_lps(room, 1))
    assert switch_calls(fake) == [
        ("turn_on", PUMP), ("turn_on", VALVE), ("turn_off", VALVE), ("turn_off", PUMP)]  # fmt: skip
    water = [room.state[z]["daily_vol"] for z in ZONES]
    assert water[0] > 0 and water == [water[0]] * 2  # one shot, counted on both zones
    fake.set_state("switch.crop_steering_zone_2_enabled", "off")  # one paused: both wait
    assert "Zone 2 paused" in c._blocked(room, 1)


async def test_rooms_and_hardware_keeps_one_valve_for_every_zone(hass, hass_admin_user):
    entry = await _install(hass)
    (room,) = (await _service(hass, hass_admin_user, "setup_read"))["rooms"]
    assert room["plumbing"] == "pump_one_valve"
    zones = [dict(zone) for zone in room["zones"]]
    zones[1]["valve"] = "switch.other_valve"
    with pytest.raises(HomeAssistantError, match="every zone uses that one valve"):
        await _service(
            hass,
            hass_admin_user,
            "setup_save",
            {
                "entry_id": room["entry_id"],
                "expected_revision": room["revision"],
                "room_name": room["room_name"],
                "active": room["active"],
                "plumbing": room["plumbing"],
                "hardware": dict(room["hardware"]),
                "zones": zones,
            },
        )
    assert {zone["zone_switch"] for zone in entry.data["zones"].values()} == {VALVE}
