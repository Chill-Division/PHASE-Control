"""A zone's Relearn Peak: Auto setpoints forgets the peak it learned for the zone.

On 18-20 Nov 2026 GT4's Auto setpoints held a peak of 88.5% that its substrate no longer reached:
each morning's ramp ran out of shots at 81-82%, 12-14 L a morning, and ended "suspect" (CS-404), so
nothing was learned and the peak never came down. The button lets a person say the zone changed (a
defoliation, a transplant, a probe moved): with no peak to measure against, the next ramp that stops
taking water is a plateau wherever it stops, and that is the peak from then on."""
from datetime import timedelta, timezone

import auto_setpoints as au
import controller
from test_auto_setpoints_runtime import _Clock, _clock, _flat_ramp, _rig, _tick, _writes  # noqa: F401

BUTTON = "button.crop_steering_zone_1_relearn_peak"
TARGET = "number.crop_steering_zone_1_p1_target_vwc"


def _press(fake, ago_s=0):
    """Pressed `ago_s` seconds before the controller's clock: Home Assistant stores the time in UTC."""
    at = (_Clock.current - timedelta(seconds=ago_s)).astimezone(timezone.utc)
    fake.set_state(BUTTON, at.isoformat())


def _stale(room, peak=88.5):
    """The zone holds a peak its substrate no longer reaches."""
    room.state[1]["learn"] = {**au.fresh(), "peak": peak, "gain": 0.6, "hold_days": 0}


def _alerts(fake):
    sent = [d for dom, svc, d in fake.calls if (dom, svc) == ("persistent_notification", "create")]
    return [a for a in sent if a["notification_id"] == "f2_auto_default_z1"]


def _dismissed(fake):
    return [d for dom, svc, d in fake.calls
            if (dom, svc) == ("persistent_notification", "dismiss") and d["notification_id"] == "f2_auto_default_z1"]


def test_a_press_after_a_suspect_ramp_forgets_the_old_peak_and_learns_todays(monkeypatch, capsys):
    c, fake, room = _rig()
    monkeypatch.setattr(c, "_who_changed", lambda entity, value, since: "Sam")
    _stale(room)
    vwc, now = _flat_ramp(c, fake, room)  # climbs to 33.8 and stops taking water: far under 88.5
    room.state[1]["phase"] = "P2"  # the engine ended the ramp
    _tick(c, fake, room, vwc, now + timedelta(minutes=1))
    assert room.state[1]["learn"]["outcome"] == "suspect" and len(_alerts(fake)) == 1

    _Clock.current = now + timedelta(minutes=30)
    _press(fake, ago_s=20)
    _tick(c, fake, room, vwc, _Clock.current)
    learn = room.state[1]["learn"]
    assert learn["peak"] == 33.8 and learn["outcome"] == "short"  # today's ramp, judged again
    assert learn["gain"] == 0.6  # how much a shot lifts it stays
    assert _dismissed(fake)  # CS-404 goes with what it judged by
    assert fake.sets["sensor.crop_steering_zone_1_auto_setpoints"][0] != "frozen"
    out = capsys.readouterr().out
    assert "Sam asked Auto setpoints to relearn this zone's peak: forgot 88.5%" in out


def test_a_press_mid_ramp_hands_over_to_p2_at_once_where_the_zone_stopped_taking_water(monkeypatch):
    c, fake, room = _rig()
    monkeypatch.setattr(c, "_who_changed", lambda entity, value, since: None)
    _stale(room)
    vwc, now = _flat_ramp(c, fake, room)  # flat shots far under 88.5: not believed, the ramp goes on
    assert room.state[1]["learn"]["outcome"] == "pending" and TARGET not in _writes(fake)
    _Clock.current = now + timedelta(minutes=2)
    _press(fake)
    for k in (2, 3):  # big moves go 6 points a pass
        _tick(c, fake, room, vwc, now + timedelta(minutes=k))
    assert room.state[1]["learn"]["outcome"] == "plateau"
    assert _writes(fake)[TARGET] == round(vwc - 0.1, 1)  # met, so the engine hands over to P2


def test_each_press_is_dealt_with_once_and_a_restart_does_not_take_it_for_new(monkeypatch, capsys, tmp_path):
    c, fake, room = _rig()
    monkeypatch.setattr(c, "_who_changed", lambda entity, value, since: None)
    c._state_path = str(tmp_path / "state.json")
    _stale(room)
    _press(fake)
    _tick(c, fake, room, 30.0, _Clock.current)
    assert room.state[1]["learn"]["peak"] is None
    room.state[1]["learn"]["peak"] = 31.0  # learned again since
    _tick(c, fake, room, 30.0, _Clock.current + timedelta(minutes=1))
    assert room.state[1]["learn"]["peak"] == 31.0
    c._save_state()
    c._load_state()  # what a restarted controller reads back
    _tick(c, fake, room, 30.0, _Clock.current + timedelta(minutes=2))
    assert room.state[1]["learn"]["peak"] == 31.0
    assert capsys.readouterr().out.count("asked Auto setpoints to relearn") == 1


def test_a_press_first_seen_more_than_half_an_hour_late_is_noted_not_acted_on(monkeypatch, capsys):
    c, fake, room = _rig()
    monkeypatch.setattr(c, "_who_changed", lambda entity, value, since: None)
    _stale(room)
    _press(fake, ago_s=controller.RELEARN_REQUEST_S + 60)
    _tick(c, fake, room, 30.0, _Clock.current)
    assert room.state[1]["learn"]["peak"] == 88.5
    assert "was not acted on: too long ago" in capsys.readouterr().out


def test_a_button_never_pressed_or_missing_does_nothing(monkeypatch):
    c, fake, room = _rig()
    monkeypatch.setattr(c, "_who_changed", lambda *_: (_ for _ in ()).throw(AssertionError("asked")))
    _stale(room)
    _tick(c, fake, room, 30.0, _Clock.current)  # no button: an integration older than the button
    fake.set_state(BUTTON, "unknown")  # never pressed
    _tick(c, fake, room, 30.0, _Clock.current + timedelta(minutes=1))
    assert room.state[1]["learn"]["peak"] == 88.5 and room.state[1]["learn"]["relearned"] is None


def test_relearning_forgets_the_peak_and_its_hold_and_keeps_the_rest():
    learn = {**au.fresh(), "peak": 88.5, "hold_days": 2, "prev_peak": 87.0, "prev_hold": 1, "gain": 0.6,
             "day_rate": 1.2, "night_rate": 0.8, "day_n": 3, "night_n": 3, "outcome": "suspect",
             "stalled_at": 81.2, "ramp": [{"pct": 3.0, "rise": 0.0, "settled": 81.2, "flat": True}]}
    au.relearn(learn)
    assert (learn["peak"], learn["hold_days"], learn["prev_peak"], learn["outcome"], learn["stalled_at"]) == (
        None, 0, None, "pending", None)
    assert (learn["gain"], learn["day_rate"], learn["night_rate"], learn["day_n"]) == (0.6, 1.2, 0.8, 3)
    assert learn["ramp"]  # today's ramp is judged again
    assert au.frozen_reason(learn) is None


def test_the_press_dealt_with_is_kept_and_an_older_record_loads_without_one():
    assert au.restore({**au.fresh(), "relearned": "2026-11-20T09:31:00+00:00"})["relearned"] == "2026-11-20T09:31:00+00:00"
    older = {k: v for k, v in au.fresh().items() if k != "relearned"}
    assert au.restore(older)["relearned"] is None
    assert au.restore({**au.fresh(), "relearned": 7})["relearned"] is None
