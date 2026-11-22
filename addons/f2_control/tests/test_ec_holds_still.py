"""A root-zone EC that holds still is still steered by, for up to EC_STILL_KEEP_MIN (6 hours).

GT site, 20-22 Nov 2026: the THC-S probes report EC in coarse steps, and Home Assistant keeps no reading
that repeats the last, so a steady EC looked like a dead probe once it had stayed the same for 20
minutes, as moisture does. GT3's EC held still for up to 3.9 hours, and was dropped for 40% of its P2
time: EC shot sizing, dilution, flushes and EC learning paused, and CS-104 was raised over and over and
never taken down. Moisture keeps its 20 minutes."""
from datetime import timedelta, timezone

import controller
from test_ec_and_weekly_usage import FixedDateTime, probe, rig  # noqa: F401 - rig is the fixture
from test_one_valve_room import Clock, _room as _one_valve_room, probe as one_valve_probe

EC = "sensor.crop_steering_ec_zone_1"
VWC = "sensor.crop_steering_vwc_zone_1"


def _ago(minutes):
    return (FixedDateTime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def _ec_alerts(fake, service="create"):
    return [call[2] for call in fake.calls if call[:2] == ("persistent_notification", service)
            and "ec_unknown" in call[2].get("notification_id", "")]


def test_an_ec_that_has_held_still_for_hours_is_still_steered_by(rig):  # noqa: F811
    c, fake, room, _ = rig
    probe(fake, VWC, "60")
    probe(fake, EC, "0.2", _ago(3 * 60 + 54))  # GT3's longest, 20 Nov 03:55 to 07:31
    pub = c._loop_room(room, FixedDateTime.now())
    assert pub[1]["ec"] == 0.2
    assert not _ec_alerts(fake)


def test_moisture_still_counts_as_gone_after_20_minutes(rig):  # noqa: F811
    c, fake, room, _ = rig
    probe(fake, VWC, "60", _ago(21))
    probe(fake, EC, "0.2")
    pub = c._loop_room(room, FixedDateTime.now())
    assert pub[1]["vwc"] is None and pub[1]["blind"]


def test_an_ec_unchanged_for_more_than_6_hours_is_not_and_says_so(rig):  # noqa: F811
    c, fake, room, _ = rig
    probe(fake, VWC, "60")
    probe(fake, EC, "0.2", _ago(6 * 60 + 1))
    pub = c._loop_room(room, FixedDateTime.now())
    assert pub[1]["ec"] is None
    (alert,) = _ec_alerts(fake)
    assert "it is missing, unavailable, out of range, or hasn't changed for 6 hours." in alert["message"]


def test_the_ec_notification_goes_once_the_ec_reads_again_and_is_not_dismissed_every_pass(rig):  # noqa: F811
    c, fake, room, _ = rig
    probe(fake, VWC, "60")
    probe(fake, EC, "unavailable")
    c._loop_room(room, FixedDateTime.now())
    assert len(_ec_alerts(fake)) == 1
    probe(fake, EC, "0.2")
    c._loop_room(room, FixedDateTime.now())
    assert [d["notification_id"] for d in _ec_alerts(fake, "dismiss")] == ["f2_ec_unknown_default_z1"]
    c._loop_room(room, FixedDateTime.now())
    assert len(_ec_alerts(fake, "dismiss")) == 1  # not every pass
    # An EC that comes and goes is said no more often than before: once in 30 minutes.
    probe(fake, EC, "unavailable")
    c._loop_room(room, FixedDateTime.now())
    assert len(_ec_alerts(fake)) == 1
    FixedDateTime.instant += timedelta(minutes=31)
    probe(fake, VWC, "60")
    c._loop_room(room, FixedDateTime.now())
    assert len(_ec_alerts(fake)) == 2
    probe(fake, EC, "0.2")  # and back: that card goes too
    c._loop_room(room, FixedDateTime.now())
    assert len(_ec_alerts(fake, "dismiss")) == 2


def test_one_raised_before_a_start_goes_at_the_first_reading_after_it(rig):  # noqa: F811
    """GT4, 22 Nov 2026: its card from five hours before was still up, its EC long back."""
    c, fake, room, _ = rig
    probe(fake, VWC, "60")
    probe(fake, EC, "1.3")
    c._loop_room(room, FixedDateTime.now())
    assert [d["notification_id"] for d in _ec_alerts(fake, "dismiss")] == ["f2_ec_unknown_default_z1"]
    c._loop_room(room, FixedDateTime.now())
    assert len(_ec_alerts(fake, "dismiss")) == 1


def test_a_one_valve_rooms_ec_holds_still_too(monkeypatch):
    c, fake, room = _one_valve_room(monkeypatch)
    group = c._valve_group(room)
    for zone in (1, 2, 3):
        one_valve_probe(fake, zone, 50, ec=0.4)
    stamp = (Clock.now(timezone.utc) - timedelta(hours=3)).isoformat()
    fake.set_state("sensor.crop_steering_ec_zone_2", "0.4", last_updated=stamp)
    assert c._group_readings(room, group)[2][2][1] == 0.4  # unchanged for 3 hours: in
    stamp = (Clock.now(timezone.utc) - timedelta(hours=6, minutes=1)).isoformat()
    fake.set_state("sensor.crop_steering_ec_zone_2", "0.4", last_updated=stamp)
    assert c._group_readings(room, group)[2][2][1] is None


def test_the_heartbeat_says_how_long_the_ec_may_hold_still(rig):  # noqa: F811
    c, fake, room, _ = rig
    c._heartbeat(room, FixedDateTime.now(), None)
    _state, attrs = fake.sets["sensor.crop_steering_ai_heartbeat"]
    assert attrs["max_ec_age_s"] == controller.EC_STILL_KEEP_MIN * 60 == 6 * 3600
