"""Home Assistant restarting or updating in the middle of a refill or a shot.

While Home Assistant is away nothing can be read or switched, so the controller waits for it: a switch
that can't be read is not one switched off, nothing latches the hardware hold, and a refill pauses.
As Home Assistant shuts down the integration switches the room's pumps, valves and dosers off (its
shutdown.py), after saying so on the room's descriptor, so the controller tells that from a person
switching something off. Once Home Assistant is back a refill carries on, its fill and its step moved
on by as long as their switches were off, or stops cleanly when a dose was cut short.

Before this a Core update in the middle of a refill stopped it with "the room's watering switch was
switched off", latched the hardware hold, and nothing switched the refill's pump or recirculation off
once Home Assistant was back."""
from datetime import datetime, timedelta, timezone

import pytest

import controller
from test_nutrient_batch import (  # noqa: F401 - clock is the autouse fake clock
    DOSER,
    FRESH,
    KILL,
    PUMP,
    RECIRC,
    ROOMY,
    STATUS,
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

DESCRIPTOR = "sensor.crop_steering_engine_config"
REAL_HA_RUNNING = controller.ha_running  # before any test's fake replaces it


@pytest.fixture
def rig():
    c, fake, room = _room(plan=ROOMY)  # its Home Assistant answers, or doesn't: fake.running
    _tick(c, room)
    _press(c, fake, room)
    assert room.batch["step"] == "filling" and fake.states[FRESH][0] == "on"
    return c, fake, room


def _utc(local):
    return local.astimezone(timezone.utc).isoformat()


def _shutting_down(fake, *switches):
    """Home Assistant starts shutting down: the integration says so on the room's descriptor, then
    switches the room's hardware off. Returns when they went off."""
    state, attrs = fake.states[DESCRIPTOR][:2]
    fake.set_state(DESCRIPTOR, state, {**attrs, "shutting_down_at": _utc(_Clock.now())})
    off_at = _Clock.now()
    for entity in switches:
        fake.history[entity] = [("on", _utc(off_at - timedelta(seconds=30))), ("off", _utc(off_at))]
        fake.set_state(entity, "off")
    return off_at


def _gone(fake):
    fake.running = False


def _back(c, fake, *off, unavailable=()):
    """Home Assistant has started again: the descriptor is the integration's new one, and each switch
    reads as its device reconnected (Home Assistant's history shows it going unavailable meanwhile)."""
    fake.running = True
    state, attrs = fake.states[DESCRIPTOR][:2]
    fake.set_state(DESCRIPTOR, state, {k: v for k, v in attrs.items() if k != "shutting_down_at"})
    for entity in off:
        fake.history.setdefault(entity, []).extend(
            [("unavailable", _utc(_Clock.now() - timedelta(seconds=5))), ("off", _utc(_Clock.now()))]
        )
    for entity in unavailable:
        fake.set_state(entity, "unavailable")
    assert c._ha_answers(_Clock.now())


# ---------------------------------------------------------------- a refill
def test_a_restart_mid_fill_pauses_it_and_carries_it_on_for_the_fill_time_it_missed(rig):
    c, fake, room = rig
    fill_end = datetime.fromisoformat(room.batch["fill_end"])
    half_way = datetime.fromisoformat(room.batch["until"])
    _later(20)
    off_at = _shutting_down(fake, FRESH)
    c._wait_for_next_pass()  # the batch's watch, between passes, sees the fresh water go off
    assert room.batch["step"] == "filling" and room.batch["away"]
    assert not _alerts(fake, "CS-701") and not room.hardware_fault

    _gone(fake)
    _later(40)
    fake.calls.clear()
    c.loop_once(_Clock.now())  # nothing answers: the pass waits
    assert c._sleep_for(_Clock.now()) == controller.HA_AWAY_POLL_S
    _later(5)
    _back(c, fake, FRESH)
    _tick(c, room)

    assert fake.states[FRESH][0] == "on" and room.batch["away"] is None
    missed = (_Clock.now() - off_at).total_seconds()
    assert (datetime.fromisoformat(room.batch["fill_end"]) - fill_end).total_seconds() == pytest.approx(missed, abs=2)
    assert (datetime.fromisoformat(room.batch["until"]) - half_way).total_seconds() == pytest.approx(missed, abs=2)
    assert not room.hardware_fault and not _alerts(fake, "CS-701") and not _alerts(fake, "CS-301")
    _to_end(c, fake, room)
    last = room.batch["last"]
    assert (last["result"], last["dosed"]) == ("done", {"2": 100.0, "1": 50.0})
    assert all(fake.states[e][0] == "off" for e in (FRESH, RECIRC, PUMP, *DOSER.values()))


def test_a_restart_while_it_mixes_switches_the_line_back_on_before_the_pump(rig):
    c, fake, room = rig
    _level(fake, 88.0)
    while room.batch["step"] != "pausing":
        _step_on(c, room)
    until = datetime.fromisoformat(room.batch["until"])
    _shutting_down(fake, FRESH, PUMP, RECIRC)
    _tick(c, room)  # read in the moment before Home Assistant stops answering: paused, not stopped
    assert room.batch["away"] and room.batch["step"] == "pausing"
    _gone(fake)
    _later(30)
    _back(c, fake, FRESH, PUMP, RECIRC)
    fake.calls.clear()
    _tick(c, room)
    assert [(d["entity_id"], s) for _dom, s, d in fake.calls if _dom == "switch"] == [
        (FRESH, "turn_on"), (RECIRC, "turn_on"), (PUMP, "turn_on")
    ]
    assert datetime.fromisoformat(room.batch["until"]) > until
    _to_end(c, fake, room)
    assert room.batch["last"]["result"] == "done"


def test_a_restart_mid_dose_stops_the_batch_cleanly_and_counts_the_dose_to_when_it_went_off(rig):
    c, fake, room = rig
    _level(fake, 88.0)
    while room.batch["step"] != "dosing":
        _step_on(c, room)
    _later(4)  # Bloom has run about 4 of its 10 s
    _shutting_down(fake, DOSER[2], FRESH, PUMP, RECIRC)
    _tick(c, room)
    assert room.batch["away"] and room.batch["step"] == "dosing"
    _gone(fake)
    _later(60)  # long enough that counting to now would say the whole 100 mL went in
    _back(c, fake, DOSER[2], FRESH, PUMP, RECIRC)
    _tick(c, room)

    assert room.batch["step"] == "idle" and room.batch["away"] is None
    assert 30 <= room.batch["last"]["dosed"]["2"] <= 60  # not the 100 mL counting to now says
    (note,) = _alerts(fake, "CS-701")
    assert "while dosing: Home Assistant restarted while doser 2 was dosing, so its dose was cut short" in note["message"]
    assert not room.hardware_fault and not _alerts(fake, "CS-301")
    assert all(fake.states[e][0] == "off" for e in (FRESH, RECIRC, PUMP, *DOSER.values()))


def test_home_assistant_vanishing_without_a_shutdown_pauses_it_and_nothing_is_switched(rig):
    """A crash or the network dropping: the integration never switched anything off, and the device
    kept the fresh water running. Once Home Assistant is back the refill carries on as it was: its
    water ran all along, so nothing moves on."""
    c, fake, room = rig
    fill_end = room.batch["fill_end"]
    _gone(fake)
    c._wait_for_next_pass()
    assert room.batch["away"] and room.batch["step"] == "filling" and not room.hardware_fault
    _later(20)
    _back(c, fake)
    fake.calls.clear()
    _tick(c, room)
    assert room.batch["away"] is None and room.batch["fill_end"] == fill_end
    assert fake.states[FRESH][0] == "on" and not [call for call in fake.calls if call[0] == "switch"]


def test_a_switch_that_has_not_come_back_is_waited_for_then_the_refill_stops(rig):
    c, fake, room = rig
    _shutting_down(fake, FRESH)
    _tick(c, room)
    _gone(fake)
    _later(30)
    _back(c, fake, unavailable=(FRESH,))
    _tick(c, room)
    assert room.batch["step"] == "filling" and room.batch["away"]  # its device is still reconnecting
    _later(controller.RESUME_GRACE_S + 1)
    _tick(c, room)
    assert room.batch["step"] == "idle"
    (note,) = _alerts(fake, "CS-701")
    assert f"{FRESH} did not come back after Home Assistant restarted" in note["message"]


def test_watering_switched_off_while_home_assistant_was_away_stops_the_refill_once_it_is_back(rig):
    c, fake, room = rig
    _shutting_down(fake, FRESH)
    _tick(c, room)
    _gone(fake)
    _later(30)
    fake.set_state(KILL, "off")
    _back(c, fake, FRESH)
    _tick(c, room)
    assert room.batch["step"] == "idle" and fake.states[FRESH][0] == "off"
    (note,) = _alerts(fake, "CS-701")
    assert f"the room's watering switch ({KILL}) was switched off" in note["message"]


def test_a_switch_a_person_switches_off_while_home_assistant_runs_still_stops_the_refill(rig):
    c, fake, room = rig
    fake.set_state(FRESH, "off")
    _tick(c, room)
    assert room.batch["step"] == "idle" and room.batch["away"] is None
    (note,) = _alerts(fake, "CS-701")
    assert f"{FRESH} was switched off" in note["message"]


def test_a_watering_switch_that_cannot_be_read_says_so_rather_than_switched_off(rig):
    c, fake, room = rig
    fake.set_state(KILL, "unavailable")
    _tick(c, room)
    (note,) = _alerts(fake, "CS-701")
    assert f"the room's watering switch ({KILL}) can't be read" in note["message"]


def test_the_status_keeps_saying_the_refill_while_it_is_paused(rig):
    c, fake, room = rig
    _shutting_down(fake, FRESH)
    _tick(c, room)
    assert room.batch["away"] and fake.sets[STATUS][0] == "filling"


# ---------------------------------------------------------------- a shot
@pytest.fixture
def shot(monkeypatch):
    from test_interrupted_shot import Clock

    import fake_ha

    fake = fake_ha.FakeHA()
    options = {"num_zones": 1, "enable_flag": "input_boolean.kill",
               "hardware": {"pump": "switch.p", "mainline": "switch.m", "valves": {"1": "switch.v1"}}}
    monkeypatch.setattr(controller, "load_options", lambda: options)
    for name in ("ha_get", "ha_call", "ha_get_all", "ha_set", "ha_history", "ha_running"):
        monkeypatch.setattr(controller, name, getattr(fake, name))
    with monkeypatch.context() as setup:
        setup.setattr(controller.Controller, "_read_state_file", lambda self: {})
        c = controller.Controller()
    for entity in ("input_boolean.kill", "switch.crop_steering_zone_1_enabled"):
        fake.set_state(entity, "on")
    for entity in ("switch.p", "switch.m", "switch.v1"):
        fake.set_state(entity, "off")
    ticks = Clock()
    monkeypatch.setattr(controller.time, "sleep", ticks.sleep)
    monkeypatch.setattr(controller.time, "monotonic", ticks.monotonic)
    return c, fake, c.rooms[0]


def test_a_shot_that_ends_while_home_assistant_is_away_latches_nothing_and_closes_once_it_is_back(
    shot, monkeypatch, tmp_path
):
    c, fake, room = shot
    c._state_path = str(tmp_path / "state.json")

    def restart_mid_shot(room_, zone, duration_s, started=None):
        # Home Assistant shuts down part-way: the integration switches the shot's hardware off, and
        # then nothing answers until the shot is over.
        for entity in ("switch.v1", "switch.m", "switch.p"):
            fake.set_state(entity, "off")
        fake.running = False
        return duration_s, None

    monkeypatch.setattr(c, "_wait_shot", restart_mid_shot)
    c._execute_shot(room, 1, 30, 3.0)
    assert room.hardware_fault is None and room.shot_inflight  # its record waits for Home Assistant
    assert not [d for _dom, s, d in fake.calls if "CS-301" in d.get("title", "")]

    fake.running = True
    c._reconcile_inflight()
    assert room.shot_inflight is None and room.hardware_fault is None


def test_a_shot_whose_valve_will_not_close_with_home_assistant_answering_still_latches_the_hold(
    shot, monkeypatch, tmp_path
):
    c, fake, room = shot
    c._state_path = str(tmp_path / "state.json")
    monkeypatch.setattr(c, "_wait_shot", lambda room_, zone, duration_s, started=None: (duration_s, None))
    real_call = fake.ha_call
    monkeypatch.setattr(controller, "ha_call", lambda domain, service, **data: (
        False if (service, data.get("entity_id")) == ("turn_off", "switch.v1") else real_call(domain, service, **data)
    ))
    c._execute_shot(room, 1, 30, 3.0)
    assert room.hardware_fault and room.hardware_fault["reason"] == "zone 1 shot end"


# ---------------------------------------------------------------- asking Home Assistant
class _Reply:
    def __init__(self, status, body=None):
        self.status_code, self._body = status, body

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


@pytest.mark.parametrize(
    "reply, running",
    [
        (_Reply(200, {"state": "RUNNING"}), True),
        (_Reply(200, {"state": "STARTING"}), False),  # integrations still loading
        (_Reply(200, {"state": "STOPPING"}), False),
        (_Reply(502), False),  # the Supervisor's proxy, while Core is down
        (_Reply(504), False),
        (ConnectionError("refused"), False),
        (_Reply(200, {}), True),  # says nothing about its state: taken as running, as before
        (_Reply(200, ValueError("not json")), True),
        (_Reply(404), True),
        (_Reply(401), True),  # a token problem is not Home Assistant being away
    ],
)
def test_home_assistant_counts_as_away_only_while_plainly_away(monkeypatch, reply, running):
    def get(url, headers=None, timeout=None):
        assert url.endswith("/core/state")
        if isinstance(reply, Exception):
            raise reply
        return reply

    monkeypatch.setattr(controller._S, "get", get)
    assert REAL_HA_RUNNING() is running


def test_away_and_back_are_each_said_once(rig, capsys):
    c, fake, room = rig
    _gone(fake)
    for _ in range(3):
        c.loop_once(_Clock.now())
        _later(5)
    _back(c, fake)
    c._ha_answers(_Clock.now())
    out = capsys.readouterr().out
    assert out.count("Home Assistant is not answering") == 1
    assert out.count("Home Assistant is back after 15 s: carrying on") == 1
