"""The room order, in a real Home Assistant: the order the dashboard lists the rooms in, chosen in its
Settings and kept for the whole installation.

Owner, 2026-10-22: GR1 was set up after GR2, and the dashboard listed it second with no way to move
it. Each room's descriptor publishes its place (`room_position`): None until an order names the
room, so an installation from before this, and every new one, lists its rooms as it always has.
"""

import pytest
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.exceptions import HomeAssistantError
from test_setup_entry import _install
from test_upgrade_in_place import _upgrade

DOMAIN = "crop_steering"
STORE = "crop_steering.room_order"
FIRST = "sensor.crop_steering_engine_config"
SECOND = "sensor.crop_steering_veg_tent_engine_config"


async def _add_room(hass, name="Veg tent", valve="switch.veg_tent", probe="sensor.veg_vwc"):
    """A second room through the setup wizard, as a grower adds one."""
    hass.states.async_set(valve, "off")
    hass.states.async_set(probe, "50", {"unit_of_measurement": "%"})
    flow = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    flow = await hass.config_entries.flow.async_configure(flow["flow_id"], {"room_name": name})
    flow = await hass.config_entries.flow.async_configure(
        flow["flow_id"], {"num_zones": 1, "plumbing": "valves_only"}
    )
    flow = await hass.config_entries.flow.async_configure(
        flow["flow_id"], {"zone_1_switch": valve, "zone_1_vwc": [probe]}
    )
    done = await hass.config_entries.flow.async_configure(flow["flow_id"], {})
    assert done["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()


async def _save(hass, rooms):
    return await hass.services.async_call(
        DOMAIN, "room_order_save", {"rooms": rooms}, blocking=True, return_response=True
    )


def _place(hass, descriptor):
    return hass.states.get(descriptor).attributes["room_position"]


async def test_a_new_installation_publishes_no_place_until_an_order_is_chosen(
    hass, hass_storage
):
    await _install(hass)
    assert _place(hass, FIRST) is None
    assert STORE not in hass_storage


async def test_an_installation_from_before_this_loads_and_lists_its_rooms_as_before(
    hass, hass_storage
):
    await _upgrade(
        hass,
        "entry_2_17_wizard.json",
        registry_ids={FIRST: "engine_config"},
    )
    assert _place(hass, FIRST) is None
    assert STORE not in hass_storage


async def test_the_chosen_order_reaches_every_room_at_once_and_survives_a_restart(
    hass, hass_storage
):
    await _install(hass)
    await _add_room(hass)
    assert (_place(hass, FIRST), _place(hass, SECOND)) == (None, None)

    # GR1 above GR2: the room set up second first.
    assert await _save(hass, ["room:veg_tent_", "room:"]) == {
        "order": ["room:veg_tent_", "room:"]
    }
    await hass.async_block_till_done()
    assert (_place(hass, SECOND), _place(hass, FIRST)) == (0, 1)
    assert hass_storage[STORE]["data"] == {"order": ["veg_tent_", ""]}

    # Home Assistant restarts: every room unloads, and sets up again from the stored order.
    entries = hass.config_entries.async_entries(DOMAIN)
    for entry in entries:
        assert await hass.config_entries.async_unload(entry.entry_id)
    assert not hass.services.has_service(DOMAIN, "room_order_save")
    for entry in entries:
        assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert (_place(hass, SECOND), _place(hass, FIRST)) == (0, 1)


async def test_a_room_added_after_the_order_was_chosen_is_listed_after_it(hass, hass_storage):
    await _install(hass)
    await _add_room(hass)
    await _save(hass, ["room:veg_tent_", "room:"])
    await _add_room(hass, "Mother room", "switch.mothers", "sensor.mothers_vwc")
    await hass.async_block_till_done()
    assert _place(hass, "sensor.crop_steering_mother_room_engine_config") is None
    assert (_place(hass, SECOND), _place(hass, FIRST)) == (0, 1)


@pytest.mark.parametrize(
    "rooms",
    [["room:nowhere_", "room:"], ["room:", "room:"], ["Flower 2"]],
    ids=["no such room", "twice", "not a room id"],
)
async def test_an_order_naming_a_room_that_is_not_there_or_twice_is_refused(
    hass, hass_storage, rooms
):
    await _install(hass)
    with pytest.raises(HomeAssistantError):
        await _save(hass, rooms)
    assert STORE not in hass_storage
    assert _place(hass, FIRST) is None
