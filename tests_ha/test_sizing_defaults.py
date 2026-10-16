"""A new room's pot size, dripper flow and drippers per plant start at 3.2 L, 4 L/hr and one. Since
1.3.0 the setup wizard no longer asks them (each zone is sized on Rooms & hardware), so they are
the settings' own defaults. They are only what a room with no answer yet starts at: a room set up
before keeps what its setup recorded, and one the operator sized keeps their numbers
(test_upgrade_in_place.test_everything_the_operator_tuned_survives_the_upgrade)."""

from conftest import fixture
from test_setup_entry import _install
from test_upgrade_in_place import _known_numbers, _upgrade

SIZING = (
    "number.crop_steering_substrate_volume",
    "number.crop_steering_dripper_flow_rate",
    "number.crop_steering_drippers_per_plant",
)


def _sizing(hass):
    return tuple(float(hass.states.get(entity_id).state) for entity_id in SIZING)


async def test_a_new_room_starts_at_a_3_2_l_pot_and_one_4_l_hr_dripper(hass):
    entry = await _install(hass)
    # The wizard records only the lights hours; the settings start from their defaults.
    assert set(entry.data["parameters"]) == {"lights_on_hour", "lights_off_hour"}
    assert _sizing(hass) == (3.2, 4.0, 1.0)


async def test_a_room_set_up_before_keeps_what_its_setup_recorded(hass):
    # 2.18's wizard recorded a 6 L pot and one 2 L/hr dripper; nobody changed them since.
    seed = fixture("entry_2_18_one_switch_tent.json")
    await _upgrade(
        hass, "entry_2_18_one_switch_tent.json", registry_ids=_known_numbers(seed)
    )
    assert _sizing(hass) == (6.0, 2.0, 1.0)
