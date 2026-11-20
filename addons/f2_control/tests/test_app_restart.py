"""The controller app stopping in the middle of a refill: an update, a Rebuild, a restart by hand.

The Supervisor builds an update while the old app runs, then stops it (10 s to finish) and starts the
new one, so the app is away for seconds; a Rebuild stops it first and builds after. As it stops, the
controller switches off what the refill has on, as it always did, but pauses the refill instead of
ending it. A new start within APP_RESUME_S carries it on as after a Home Assistant restart (its fill
and its step run on for as long as their switches were off; a dose cut short stops it cleanly); one
later finds it stopped, and says so. Before this, stopping the app ended a refill part-way, the tank
part-filled or part-dosed for a person to sort out."""
from datetime import datetime, timedelta, timezone

import controller
from test_nutrient_batch import (  # noqa: F401 - clock is the autouse fake clock
    DOSER,
    FRESH,
    KILL,
    PUMP,
    RECIRC,
    ROOMY,
    _alerts,
    _Clock,
    _later,
    _level,
    _press,
    _room,
    _step_on,
    _tick,
    _to_end,
    clock,
)


def _utc(local):
    return local.astimezone(timezone.utc).isoformat()


def _stop_app(c, fake, *went_off):
    """The Supervisor stops the app: it switches the refill off (Home Assistant records each switch
    going off) and saves its state on the way out."""
    at = _Clock.now()
    c._safe_off()
    c._save_state()
    for entity in went_off:
        fake.history[entity] = [("on", _utc(at - timedelta(seconds=30))), ("off", _utc(at))]
    return at


def _start_app(c, room, after_s):
    """The new app starts `after_s` seconds later, from the state file the old one saved."""
    _later(after_s)
    again = controller.Controller.__new__(controller.Controller)
    again.__dict__.update(c.__dict__)
    again._started = _Clock.now()
    again._ha_away_since = again._ha_back_at = None
    again.rooms = [controller.Room("default", "", room.zones, room.hw, KILL, 10, 22)]
    again._load_state()
    return again, again.rooms[0]


def _filling():
    c, fake, room = _room(plan=ROOMY)
    _tick(c, room)
    _press(c, fake, room)
    return c, fake, room


def test_an_update_mid_fill_pauses_the_refill_and_the_new_app_carries_it_on(capsys):
    c, fake, room = _filling()
    fill_end = datetime.fromisoformat(room.batch["fill_end"])
    _later(20)
    stopped = _stop_app(c, fake, FRESH)
    assert fake.states[FRESH][0] == "off" and room.batch["step"] == "filling"

    c, room = _start_app(c, room, 90)
    assert not room._batch_crashed  # paused, not a crash
    _tick(c, room)
    assert fake.states[FRESH][0] == "on" and room.batch["away"] is None and room.batch["app_stopped"] is None
    moved = (datetime.fromisoformat(room.batch["fill_end"]) - fill_end).total_seconds()
    assert abs(moved - (_Clock.now() - stopped).total_seconds()) <= 2
    assert not _alerts(fake, "CS-701") and not room.hardware_fault
    assert "reservoir refill carried on after the controller app restarted: the fresh water back on" in capsys.readouterr().out
    _to_end(c, fake, room)
    assert (room.batch["last"]["result"], room.batch["last"]["dosed"]) == ("done", {"2": 100.0, "1": 50.0})


def test_an_update_mid_dose_stops_the_batch_cleanly_when_the_new_app_starts():
    c, fake, room = _filling()
    _level(fake, 88.0)
    while room.batch["step"] != "dosing":
        _step_on(c, room)
    _later(4)  # Bloom has run about 4 of its 10 s
    _stop_app(c, fake, DOSER[2], FRESH, PUMP, RECIRC)
    c, room = _start_app(c, room, 60)
    _tick(c, room)
    assert room.batch["step"] == "idle"
    assert 30 <= room.batch["last"]["dosed"]["2"] <= 60  # not the 100 mL counting to now says
    (note,) = _alerts(fake, "CS-701")
    assert "the controller app restarted while doser 2 was dosing, so its dose was cut short" in note["message"]
    assert all(fake.states[e][0] == "off" for e in (FRESH, RECIRC, PUMP, *DOSER.values()))


def test_an_app_back_after_more_than_ten_minutes_stops_the_refill_and_says_so_once():
    c, fake, room = _filling()
    _stop_app(c, fake, FRESH)
    c, room = _start_app(c, room, controller.APP_RESUME_S + 60)
    _tick(c, room)
    _tick(c, room)
    assert room.batch["step"] == "idle" and fake.states[FRESH][0] == "off"
    (note,) = _alerts(fake, "CS-701")
    assert "the controller app was stopped for 11 min, too long to carry it on" in note["message"]


def test_watering_switched_off_while_the_app_was_stopped_stops_the_refill():
    c, fake, room = _filling()
    _stop_app(c, fake, FRESH)
    fake.set_state(KILL, "off")
    c, room = _start_app(c, room, 30)
    _tick(c, room)
    assert room.batch["step"] == "idle" and fake.states[FRESH][0] == "off"
    (note,) = _alerts(fake, "CS-701")
    assert f"the room's watering switch ({KILL}) was switched off" in note["message"]


def test_the_app_stopping_while_home_assistant_is_away_pauses_it_until_both_are_back():
    """A host reboot: Home Assistant goes, then the app. Nothing could be switched off, so the device
    kept the fresh water running, and the refill carries on as it was once both are back."""
    c, fake, room = _filling()
    fill_end = room.batch["fill_end"]
    fake.running = False
    c._safe_off()
    c._save_state()
    c, room = _start_app(c, room, 120)
    c.loop_once(_Clock.now())  # Home Assistant isn't back yet: the pass waits
    assert room.batch["step"] == "filling" and room.batch["app_stopped"]
    _later(60)
    fake.running = True
    assert c._ha_answers(_Clock.now())
    _tick(c, room)
    assert room.batch["away"] is None and room.batch["fill_end"] == fill_end
    assert fake.states[FRESH][0] == "on" and not _alerts(fake, "CS-701")


def test_a_refill_an_older_app_stopped_is_still_said_once():
    """The update to this version: the old app ends a refill as it stops, and the new one says so."""
    c, fake, room = _filling()
    now = _Clock.now()
    room.batch.update(step="idle", until=None, on_at=None, index=0,
                      interrupted={"at": now.isoformat(), "step": "filling", "stage": "Flower"})
    c._save_state()
    c, room = _start_app(c, room, 60)
    _tick(c, room)
    _tick(c, room)
    (note,) = _alerts(fake, "CS-701")
    assert "the controller app was stopped" in note["message"] and room.batch["interrupted"] is None
