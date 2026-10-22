"""Two probes in one zone, in a real Home Assistant with the real controller: each zone has a choice
of how its probes become its one moisture reading, and separately its one EC reading (Average,
Median, Lowest, Highest). Average until someone chooses, which is how every zone read before; a new
choice shows at once, the zone's sensors say what each probe reads and what every choice gives, and
the controller steers on the chosen reading."""

from homeassistant.data_entry_flow import FlowResultType

from test_real_flow import ZONES, _seed, _to_zones_step
from test_upgrade_in_place import _upgrade

DOOR, AC = "sensor.thc_s_door_end_humidity", "sensor.thc_s_ac_end_humidity"
DOOR_EC, AC_EC = (
    "sensor.thc_s_door_end_conductivity",
    "sensor.thc_s_ac_end_conductivity",
)
VWC, EC = "sensor.crop_steering_vwc_zone_1", "sensor.crop_steering_ec_zone_1"
VWC_METHOD = "select.crop_steering_zone_1_vwc_method"
EC_METHOD = "select.crop_steering_zone_1_ec_method"


async def _install_two_probes(hass):
    """The owner's GR2: THC-S probes at the door end and the AC end of one zone."""
    _seed(hass)
    hass.states.async_set(DOOR, "83.5", {"unit_of_measurement": "%"})
    hass.states.async_set(AC, "87.7", {"unit_of_measurement": "%"})
    hass.states.async_set(DOOR_EC, "525", {"unit_of_measurement": "µS/cm"})
    hass.states.async_set(AC_EC, "832", {"unit_of_measurement": "µS/cm"})
    flow_id = await _to_zones_step(hass)
    zones = {**ZONES, "zone_1_vwc": [DOOR, AC], "zone_1_ec": [DOOR_EC, AC_EC]}
    result = await hass.config_entries.flow.async_configure(flow_id, zones)
    assert result["step_id"] == "hardware", result.get("errors")
    result = await hass.config_entries.flow.async_configure(
        flow_id, {}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY, result
    await hass.async_block_till_done()


async def _choose(hass, select, option):
    await hass.services.async_call(
        "select",
        "select_option",
        {"entity_id": select, "option": option},
        blocking=True,
    )
    await hass.async_block_till_done()


async def test_a_zone_averages_its_probes_until_a_choice_and_shows_a_new_one_at_once(
    hass,
):
    await _install_two_probes(hass)
    assert hass.states.get(VWC_METHOD).state == "Average"
    assert hass.states.get(VWC_METHOD).attributes["options"] == [
        "Average",
        "Median",
        "Lowest",
        "Highest",
    ]
    vwc = hass.states.get(VWC)
    assert float(vwc.state) == 85.6
    assert vwc.attributes["probes"] == {DOOR: 83.5, AC: 87.7}
    assert vwc.attributes["combined"] == {
        "Average": 85.6,
        "Median": 85.6,
        "Lowest": 83.5,
        "Highest": 87.7,
    }

    await _choose(hass, VWC_METHOD, "Lowest")
    vwc = hass.states.get(VWC)
    assert float(vwc.state) == 83.5 and vwc.attributes["method"] == "Lowest"
    # EC is chosen apart: still the average of 525 and 832 µS/cm, in mS/cm.
    assert float(hass.states.get(EC).state) == 0.68
    await _choose(hass, EC_METHOD, "Highest")
    assert float(hass.states.get(EC).state) == 0.83


async def test_the_controller_steers_on_the_chosen_reading(hass, controller_for):
    await _install_two_probes(hass)
    await _choose(hass, VWC_METHOD, "Lowest")
    c, fake, _clock = controller_for({})
    room = c.rooms[0]
    # What _snapshot reads for the zone's moisture each pass.
    fused = c._fused_id(room.prefix, "vwc", 1, room.zones[1].get("vwc"))
    assert fused == VWC and c._read_sensor(fused, lo=0, hi=100) == 83.5


async def test_an_upgraded_zone_gets_the_choices_at_average_and_reads_as_before(hass):
    await _upgrade(hass, "entry_2_17_wizard.json")
    for metric in ("vwc", "ec"):
        assert (
            hass.states.get(f"select.crop_steering_zone_1_{metric}_method").state
            == "Average"
        )
    assert float(hass.states.get(EC).state) == 3.4  # as test_upgrade_in_place has it
