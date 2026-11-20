"""Home Assistant shutting down (a restart, a Core update) switches off what a room has mapped that is
on, in the first of its shutdown stages, while every device is still connected, and the room's
descriptor says Home Assistant is shutting down before anything goes off.

The relays here are real switch entities on Home Assistant's own test platform, so a turn_off reaches
them as it reaches an ESPHome relay, and `hass.async_stop()` runs Home Assistant's real shutdown
stages. On a real install Home Assistant going away leaves a relay as it was: on Home Assistant
2026.11.2 one on an ESPHome device stayed on right through a restart."""

from homeassistant.components.switch import SwitchEntity
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.setup import async_setup_component

from ha_testing import setup_test_component_platform
from test_real_flow import VALVE, ZONES, _to_zones_step
from test_setup_save_plumbing import _payload, _room, _service

DESCRIPTOR = "sensor.crop_steering_engine_config"
PUMP = "switch.tent_pump"
FRESH = "switch.mainswater"
RECIRC = "switch.recirc"
DOSER_1 = "switch.doser_1_power"
DOSER_2 = "switch.doser_2_power"
LIGHT = "switch.grow_light"  # not the room's
RESERVOIR = {
    "reservoir_distance_sensor": "sensor.res_distance",
    "fresh_water_switch": FRESH,
    "recirc_switch": RECIRC,
    "doser_1_switch": DOSER_1,
    "doser_2_switch": DOSER_2,
}


class Relay(SwitchEntity):
    """A relay as Home Assistant has it: on or off, and switched by turn_on and turn_off."""

    _attr_should_poll = False

    def __init__(self, entity_id):
        self.entity_id = entity_id
        self._attr_name = entity_id.split(".", 1)[1]
        self._attr_is_on = False
        self.offs = 0

    async def async_turn_on(self, **kwargs):
        self._attr_is_on = True
        self.async_write_ha_state()

    async def async_turn_off(self, **kwargs):
        self._attr_is_on = False
        self.offs += 1
        self.async_write_ha_state()


async def _relays(hass):
    relays = {e: Relay(e) for e in (PUMP, VALVE, FRESH, RECIRC, DOSER_1, DOSER_2, LIGHT)}
    setup_test_component_platform(hass, "switch", list(relays.values()))
    assert await async_setup_component(hass, "switch", {"switch": [{"platform": "test"}]})
    await hass.async_block_till_done()
    return relays


async def _room_with_a_reservoir(hass, admin):
    hass.states.async_set("sensor.gt1_vwc", "41", {"unit_of_measurement": "%"})
    hass.states.async_set("sensor.gt1_ec", "3100", {"unit_of_measurement": "µS/cm"})
    hass.states.async_set("sensor.res_distance", "846.41", {"unit_of_measurement": "mm"})
    flow_id = await _to_zones_step(hass, "pump_valves")
    result = await hass.config_entries.flow.async_configure(flow_id, dict(ZONES))
    assert result["step_id"] == "hardware", result.get("errors")
    result = await hass.config_entries.flow.async_configure(flow_id, {"pump_switch": PUMP})
    assert result["type"] is FlowResultType.CREATE_ENTRY, result
    await hass.async_block_till_done()
    room = await _room(hass, admin)
    await _service(hass, admin, "setup_save", _payload(room, hardware=RESERVOIR))
    await hass.async_block_till_done()
    descriptor = hass.states.get(DESCRIPTOR).attributes
    assert (descriptor["pump"], [*descriptor["valves"].values()], descriptor["fresh_water_switch"]) == (
        PUMP,
        [VALVE],
        FRESH,
    )
    return result["result"]


async def _switch_on(hass, *entities):
    for entity in entities:
        await hass.services.async_call("switch", "turn_on", {"entity_id": entity}, blocking=True)


async def test_shutting_down_switches_off_what_the_room_has_on_before_integrations_stop(
    hass, hass_admin_user
):
    relays = await _relays(hass)
    await _room_with_a_reservoir(hass, hass_admin_user)
    await _switch_on(hass, PUMP, VALVE, FRESH, RECIRC, DOSER_1, LIGHT)  # doser 2 stays off
    went_off, said = [], {}

    @callback
    def changed(event):
        new = event.data["new_state"]
        if event.data["entity_id"] in relays and new is not None and new.state == "off":
            went_off.append(event.data["entity_id"])
            said[event.data["entity_id"]] = hass.states.get(DESCRIPTOR).attributes.get(
                "shutting_down_at"
            )

    at_stop = []

    @callback
    def stopping(_event):  # integrations start stopping here: ESPHome closes its connections later
        at_stop.append({entity: hass.states.get(entity).state for entity in relays})

    hass.bus.async_listen("state_changed", changed)
    hass.bus.async_listen(EVENT_HOMEASSISTANT_STOP, stopping)
    await hass.async_stop()

    assert at_stop == [
        {PUMP: "off", VALVE: "off", FRESH: "off", RECIRC: "off", DOSER_1: "off", DOSER_2: "off",
         LIGHT: "on"}
    ]
    # What moves water or nutrient first, then the line it runs through: the pump before its line.
    assert set(went_off[:3]) == {DOSER_1, FRESH, PUMP}
    assert set(went_off[3:]) == {VALVE, RECIRC}
    # The descriptor said Home Assistant was shutting down before the first switch went off.
    assert all(said.values()) and len(said) == 5
    assert hass.states.get(DESCRIPTOR).attributes["shutting_down_at"]
    # A switch already off is left alone, and so is everything that isn't the room's.
    assert relays[DOSER_2].offs == 0
    assert relays[LIGHT].offs == 0


async def test_with_nothing_on_nothing_is_switched(hass, hass_admin_user):
    relays = await _relays(hass)
    await _room_with_a_reservoir(hass, hass_admin_user)
    calls = []

    @callback
    def called(event):
        if event.data["domain"] == "switch":
            calls.append(event.data)

    hass.bus.async_listen("call_service", called)
    await hass.async_stop()

    assert calls == []
    assert all(relay.offs == 0 for relay in relays.values())


async def test_a_room_unloaded_before_the_shutdown_is_left_alone(hass, hass_admin_user):
    relays = await _relays(hass)
    entry = await _room_with_a_reservoir(hass, hass_admin_user)
    await _switch_on(hass, PUMP)
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_stop()

    assert hass.states.get(PUMP).state == "on"
    assert relays[PUMP].offs == 0


async def test_the_descriptor_says_nothing_about_shutting_down_while_home_assistant_runs(
    hass, hass_admin_user
):
    await _relays(hass)
    await _room_with_a_reservoir(hass, hass_admin_user)
    assert "shutting_down_at" not in hass.states.get(DESCRIPTOR).attributes
