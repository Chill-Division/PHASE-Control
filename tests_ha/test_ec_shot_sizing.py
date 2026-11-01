"""The room's "EC Shot Sizing" switch on a real install: on until someone turns it off, on a new room
and on an upgraded one (shots followed root-zone EC before it existed), under the id the controller
reads. GR1, 2 Nov 2026: its probes read bulk EC, about 0.6 against a target of 5, and every shot set
to 5% went in at 2.5%; with the switch off they go in as set."""

from test_setup_entry import _install
from test_upgrade_in_place import _upgrade

SWITCH = "switch.crop_steering_ec_shot_sizing"


async def test_a_new_room_sizes_its_shots_by_ec_until_it_is_switched_off(hass):
    await _install(hass)
    assert hass.states.get(SWITCH).state == "on"
    await hass.services.async_call(
        "switch", "turn_off", {"entity_id": SWITCH}, blocking=True
    )
    assert hass.states.get(SWITCH).state == "off"


async def test_an_upgraded_room_keeps_sizing_its_shots_by_ec(hass):
    await _upgrade(hass, "entry_2_17_wizard.json")
    assert hass.states.get(SWITCH).state == "on"


async def test_the_controller_reads_the_switch_the_integration_makes(
    hass, controller_for
):
    await _install(hass)
    c, fake, _clock = controller_for({})
    room = c.rooms[0]
    assert c._params(room, 1).ec_sizing is True
    await hass.services.async_call(
        "switch", "turn_off", {"entity_id": SWITCH}, blocking=True
    )
    # What the controller reads over REST from now on (the fake is the REST view it was built on).
    fake.set_state(SWITCH, hass.states.get(SWITCH).state)
    assert c._params(room, 1).ec_sizing is False
