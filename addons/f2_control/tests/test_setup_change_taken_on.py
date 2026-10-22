"""A saved setup change is taken on within a pass, and one that switches nothing differently is
taken on with watering on.

GT4, 2026-10-19: mapping its reservoir's distance sensor, the owner switched watering off to save
and straight back on. The controller looked for a changed setup only at its five-minute re-scan, and
took one on only with the engine switch off: it found the switch on, held the whole room ("Setup
changed; disarm current and requested engine flags and verify hardware OFF"), and went on holding it
until watering was cycled off again, while the dashboard said "Steering".
"""
import controller
from test_setup_resume import KILL, _setup_alerts, _start, _states


def _save(fake, revision, kill="on", **descriptor):
    """The integration publishing a saved setup: its descriptor and the switches as they read."""
    for entity, (state, attrs) in _states(kill=kill, revision=revision, **descriptor).items():
        fake.set_state(entity, state, attrs)


def _in_force():
    c, fake = _start(_states(kill="off"))
    room = c.rooms[0]
    assert room.setup_revision == 4 and room._setup_pending is None
    fake.calls.clear()
    return c, fake, room


def test_a_remapped_valve_waits_one_pass_for_watering_off_not_the_re_scan():
    c, fake, room = _in_force()
    fake.set_state("switch.v2", "off")
    _save(fake, 5, kill="on", valves={"1": "switch.v2"})  # watering straight back on
    c._check_setups()
    assert room._setup_pending == controller.SETUP_WAITING and room.setup_revision == 4
    assert c._blocked(room, 1) == controller.SETUP_WAITING
    message = _setup_alerts(fake)[0]["message"]
    assert KILL in message and "Switch watering off: within a minute" in message
    fake.set_state(KILL, "off")
    c._check_setups()  # the next pass
    assert room._setup_pending is None and room.setup_revision == 5
    assert room.hw["valves"] == {1: "switch.v2"}


def test_each_pass_between_re_scans_checks_the_rooms_setups(monkeypatch):
    c, _fake, _room = _in_force()
    checked = []
    monkeypatch.setattr(c, "_check_setups", lambda: checked.append(True))
    monkeypatch.setattr(c, "_rediscover", lambda now: checked.append("re-scan"))
    now = controller.datetime.now()
    c._default_provisional = False
    c._last_discovery = now  # the re-scan is five minutes away
    c.loop_once(now)
    assert checked == [True]


def test_mapping_a_sensor_is_taken_on_with_watering_on():
    c, fake, room = _in_force()
    _save(fake, 5, kill="on", reservoir_distance_sensor="sensor.tank_distance")
    c._check_setups()
    assert room._setup_pending is None and room.setup_revision == 5
    assert _setup_alerts(fake) == []
    assert c._blocked(room, 1) != controller.SETUP_WAITING


def test_a_rename_alone_is_taken_on_with_watering_on():
    c, fake, room = _in_force()
    _save(fake, 5, kill="on", room_name="GT4", zone_names={"1": "Bench"})
    c._check_setups()
    assert room._setup_pending is None and room.setup_revision == 5


def test_a_sensor_change_still_waits_for_hardware_that_is_running():
    c, fake, room = _in_force()
    _save(fake, 5, kill="on", reservoir_distance_sensor="sensor.tank_distance")
    fake.set_state("switch.p", "on")  # the pump circulating the tank by hand
    c._check_setups()
    assert room._setup_pending == controller.SETUP_RUNNING
    assert len("Blocked: " + controller.SETUP_RUNNING) <= 80  # a zone's status, whole
    message = _setup_alerts(fake)[0]["message"]
    assert "switch.p" in message and KILL not in message  # watering may stay on
    assert "Once they do, it takes the setup on within a minute" in message
    fake.set_state("switch.p", "off")
    c._check_setups()
    assert room._setup_pending is None and room.setup_revision == 5


def test_a_remapped_valve_saved_with_watering_off_waits_only_for_the_pump_still_running():
    c, fake, room = _in_force()
    fake.set_state("switch.v2", "off")
    _save(fake, 5, kill="off", valves={"1": "switch.v2"})
    fake.set_state("switch.p", "on")  # the pump circulating the tank by hand
    c._check_setups()
    assert room._setup_pending == controller.SETUP_RUNNING  # watering is off already
    message = _setup_alerts(fake)[0]["message"]
    assert "switch.p" in message and KILL not in message and "Switch watering off" not in message
    fake.set_state("switch.p", "off")
    c._check_setups()
    assert room._setup_pending is None and room.hw["valves"] == {1: "switch.v2"}


def test_a_reservoir_switch_is_a_switch():
    c, fake, room = _in_force()
    fake.set_state("switch.fresh", "off")
    _save(fake, 5, kill="on", fresh_water_switch="switch.fresh")
    c._check_setups()
    assert room._setup_pending == controller.SETUP_WAITING and room.setup_revision == 4


def test_a_controller_with_nothing_in_force_keeps_the_full_gate():
    """No adopted fingerprint to compare with (a first start): nothing counts as unchanged."""
    c, _fake = _start(_states(kill="on"))
    room = c.rooms[0]
    assert room._setup_pending == controller.SETUP_WAITING
    assert getattr(room, "setup_revision", 0) == 0


def test_declaring_the_plumbing_the_switches_already_imply_is_taken_on_with_watering_on():
    """A room from before the plumbing question: its next save declares it. The pump and main
    line it has (switch.p, switch.m) already say "pump_mainline_valves"."""
    c, fake, room = _in_force()
    _save(fake, 5, kill="on", plumbing="pump_mainline_valves")
    c._check_setups()
    assert room._setup_pending is None and room.setup_revision == 5
