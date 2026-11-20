"""The integration and the controller through a Home Assistant restart: as Home Assistant shuts down
the real integration says so on the room's descriptor and switches the room's hardware off, and the
real controller, reading the switches go off in that moment, pauses a refill instead of stopping it.

What a paused refill does once Home Assistant is back is the controller's own, tested against its
fake Home Assistant (addons/f2_control/tests/test_ha_restart.py). The seam is here: the descriptor's
`shutting_down_at`, written by one layer and read by the other."""

from datetime import datetime, timedelta

from test_switch_off_at_shutdown import (
    DOSER_1,
    DOSER_2,
    FRESH,
    PUMP,
    RECIRC,
    _relays,
    _room_with_a_reservoir,
    _switch_on,
)

PLAN = {
    "stage": "Flower",
    "problem": None,
    "fill_s": 120,
    "batch_l": 145.0,
    "full_mm": 125.0,
    "empty_mm": 850.0,
    "min_pct": 5.0,
    "pause_s": 10,
    "mix_s": 10,
    "doses": [{"doser": 1, "label": "Bloom", "ml": 100.0, "seconds": 10.0}],
}


def _filling(room):
    """The refill the controller started 20 s ago: its fresh water on, the pump not yet."""
    now = datetime.now()
    room.batch.update(
        step="filling",
        started=(now - timedelta(seconds=20)).isoformat(),
        until=(now + timedelta(seconds=40)).isoformat(),
        fill_end=(now + timedelta(seconds=100)).isoformat(),
        plan=dict(PLAN),
        switches={"fresh": FRESH, "recirc": RECIRC, "pump": PUMP,
                  "dosers": {"1": DOSER_1, "2": DOSER_2}},
    )


async def test_a_refill_whose_switches_go_off_as_home_assistant_shuts_down_is_paused_not_stopped(
    hass, hass_admin_user, controller_for
):
    await _relays(hass)
    await _room_with_a_reservoir(hass, hass_admin_user)
    await _switch_on(hass, FRESH)
    await hass.async_stop()

    # What the controller reads in the moment before Home Assistant stops answering.
    c, fake, _clock = controller_for()
    room = c.rooms[0]
    assert room.hw["reservoir"]["fresh"] == FRESH and fake.states[FRESH][0] == "off"
    fake.set_state(room.enable_flag, "on")  # the room is watering
    _filling(room)
    c._batch_tick(room, datetime.now())

    assert room.batch["step"] == "filling" and room.batch["away"]
    assert room.batch["last"] is None  # not stopped
    assert not room.hardware_fault


async def test_while_home_assistant_runs_a_switch_going_off_still_stops_the_refill(
    hass, hass_admin_user, controller_for
):
    await _relays(hass)
    await _room_with_a_reservoir(hass, hass_admin_user)
    c, fake, _clock = controller_for()
    room = c.rooms[0]
    fake.set_state(room.enable_flag, "on")
    _filling(room)
    c._batch_tick(room, datetime.now())  # its fresh water reads off, and Home Assistant isn't stopping

    assert room.batch["step"] == "idle" and room.batch["away"] is None
    assert room.batch["last"]["result"] == f"stopped: {FRESH} was switched off"
