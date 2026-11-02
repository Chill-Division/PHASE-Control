"""The room's "Refill One Reservoir at a Time" switch on a real install: on until someone allows the
room to fill alongside others, on a new room and on an upgraded one, under the id the controller
reads. Owner, 3 Nov 2026: GR1 and GR2 filled from the one water supply at once, and both batches came
out too strong."""

from test_setup_entry import _install
from test_upgrade_in_place import _upgrade

SWITCH = "switch.crop_steering_refill_one_at_a_time"


async def test_a_new_room_fills_alone_until_it_is_allowed_alongside_others(hass, controller_for):
    await _install(hass)
    assert hass.states.get(SWITCH).state == "on"
    c, fake, _clock = controller_for({})
    assert c._on(SWITCH, False) is True  # the id the controller reads
    await hass.services.async_call(
        "switch", "turn_off", {"entity_id": SWITCH}, blocking=True
    )
    fake.set_state(SWITCH, hass.states.get(SWITCH).state)
    assert c._on(SWITCH, True) is False


async def test_an_upgraded_room_fills_alone(hass):
    await _upgrade(hass, "entry_2_17_wizard.json")
    assert hass.states.get(SWITCH).state == "on"
