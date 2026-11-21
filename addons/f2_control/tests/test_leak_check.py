"""A shot that takes far more from the reservoir than this room's shots usually do: water escaping, from
a burst line, a loose fitting or a lateral off its clip.

GR1, 21 Nov 2026: a lateral came off its clip at the 10:15 shot. Each 7.2 L shot took about 40 L from
the reservoir from then on (76% to 57%, then 37%, 15% and empty by 12:26), where GR1's shots took about
1.45 times their litres all morning, and nothing said so. Now, once the level has settled after a shot,
how far it took the level down is judged against how far this room's shots usually take it for their
litres, learned from its own shots: the first that takes far more warns (CS-708), the second in a row holds watering (CS-709),
and the rescue shots still run: better to try and get some water on the plants than to let them die.
Switching the room's watering off ends the hold."""
from datetime import timedelta, timezone

import pytest

import controller
from test_nutrient_batch import (  # noqa: F401 - clock is the autouse fake clock
    DISTANCE,
    FLOWER,
    KILL,
    PUMP,
    VALVE,
    P,
    S,
    _alerts,
    _Clock,
    _dismissed,
    _later,
    _level,
    _room,
    _switched,
    _tick,
    clock,
)

PER_PCT = 145 / 70  # what 1% of the reservoir holds, as a refill showed (GR1's 145 L fill)
USUAL = 1.45 / PER_PCT  # GR1's shots take 1.45 L from it a litre: 0.7 points of its level


def _gr1(pct=90.0, learned=True, **plan):
    c, fake, room = _room(plan={**FLOWER, **plan}, pct=pct)
    room.batch["litres_per_pct"] = PER_PCT
    if learned:
        room.batch.update(draw_pct_per_l=USUAL, draw_n=10)
    _tick(c, room)
    return c, fake, room


def _shot(c, fake, room, litres, to_pct):
    """One shot of `litres` (30 s at the flow that gives them), the reservoir reading `to_pct` after."""
    c._execute_shot(room, 1, 30, 3.0, flow_lps=litres / 30)
    _level(fake, to_pct)


def _settle(c, room, passes=1):
    """The passes after a shot: the level settles in DRAW_SETTLE_S, then each pass is a minute."""
    _later(controller.DRAW_SETTLE_S)
    _tick(c, room)
    for _ in range(passes - 1):
        _later(60)
        _tick(c, room)


def _taking(per_shot_l, litres=7.2):
    """The level a shot of `litres` leaves when it takes `per_shot_l` from the reservoir, per call."""
    level = {"pct": None}

    def after(c, fake, room, start=None):
        level["pct"] = start if start is not None else level["pct"]
        level["pct"] -= per_shot_l / PER_PCT
        _shot(c, fake, room, litres, level["pct"])
        return level["pct"]

    return after


# ---------------------------------------------------------------- what this room's shots usually take
def test_the_first_shots_teach_the_rooms_usual_draw_and_judge_nothing():
    """GR1's shots took about 1.45 times their litres from the tank (its drippers give more than set,
    or the fill holds less than 145 L): that is its normal, not a leak. The first three shots only teach
    it, even one that took four times its litres."""
    c, fake, room = _gr1(learned=False)
    shot = _taking(7.2 * 1.45)
    shot(c, fake, room, start=90.0)
    _settle(c, room)
    assert room.batch["draw_pct_per_l"] == pytest.approx(USUAL, abs=0.01) and room.batch["draw_n"] == 1
    for _ in range(2):
        shot(c, fake, room)
        _settle(c, room)
    assert room.batch["draw_pct_per_l"] == pytest.approx(USUAL, abs=0.01) and room.batch["draw_n"] == 3
    assert not _alerts(fake, "CS-708")


def test_a_shot_before_the_usual_is_learned_is_never_a_leak():
    c, fake, room = _gr1(learned=False)
    _taking(40.0)(c, fake, room, start=90.0)
    _settle(c, room, passes=2)
    assert not _alerts(fake, "CS-708") and room.batch["leaky"] == 0
    assert room.batch["draw_pct_per_l"] == pytest.approx(40.0 / PER_PCT / 7.2, abs=0.01)


def test_a_normal_shot_moves_the_usual_a_little_and_an_odd_one_no_further_than_twice_it():
    c, fake, room = _gr1()
    _taking(7.2 * 2.0)(c, fake, room, start=90.0)  # 2 L a litre: 0.97 points
    _settle(c, room)
    two = 2.0 / PER_PCT
    assert room.batch["draw_pct_per_l"] == pytest.approx(USUAL + controller.DRAW_ALPHA * (two - USUAL), abs=0.001)
    assert room.batch["draw_n"] == 11
    c, fake, room = _gr1()
    _taking(7.2 * 1.45 * 2.9)(c, fake, room, start=90.0)  # 2.9 times the usual: no leak, counted as twice
    _settle(c, room)
    assert room.batch["draw_pct_per_l"] == pytest.approx(USUAL * (1 + controller.DRAW_ALPHA), abs=0.001)


# ---------------------------------------------------------------- GR1, 21 Nov 2026
def test_gr1_the_first_leaky_shot_warns_and_the_second_holds_watering():
    c, fake, room = _gr1(pct=76.0)
    _shot(c, fake, room, 7.2, 57.0)  # 10:15: 19 points, about 39 L, where 7.2 L usually take 10
    _settle(c, room)
    assert not _alerts(fake, "CS-708")  # read again a pass later first: one bad echo is no leak
    _later(60)
    _tick(c, room)
    (warning,) = _alerts(fake, "CS-708")
    assert warning["title"] == "A shot took far more from the reservoir than usual (CS-708)"
    assert warning["message"].startswith(
        "A 7.2 L shot took 19% of the reservoir (about 39 L), where this room's shots that size usually "
        "take 5.0% (about 10 L). Water may be escaping, from a burst line, a loose fitting or a lateral off "
        "its clip: check the lines and fittings. If the next shot does the same, watering in this room is "
        "held.")
    assert room.batch["leaky"] == 1 and room.batch["leak_hold"] is None
    assert c._leak_block(room, 1, {1: S(vwc=50)}, {1: P()}, controller.Reason("P2", "p2_topup")) is None

    _shot(c, fake, room, 7.2, 37.0)  # 10:58: 20 points more
    _settle(c, room, passes=2)
    (hold,) = _alerts(fake, "CS-709")
    assert hold["title"] == "Watering held, a leak? (CS-709)"
    assert ("Two shots in a row took far more from the reservoir than this room's shots usually do. The "
            "last: a 7.2 L shot took 20% of the reservoir (about 41 L), where this room's shots that size "
            "usually take 5.0% (about 10 L).") in hold["message"]
    assert ("Fix the leak, then switch the room's watering off (Watching only) and back on to carry on."
            in hold["message"])
    assert _dismissed(fake, f"leak_{room.slug}")  # the hold's notification says it all
    assert room.batch["leak_hold"]["took"] == pytest.approx(20.0, abs=0.05)
    assert room.batch["draw_pct_per_l"] == USUAL  # a leaky shot teaches nothing
    # 11:40: the shot is held, and its notification stays up while it holds one
    assert c._leak_block(room, 1, {1: S(vwc=50)}, {1: P()}, controller.Reason("P2", "p2_topup")) == (
        controller.LEAK_HOLD)


def test_one_bad_echo_is_no_leak_and_the_fuller_reading_is_the_one_judged():
    c, fake, room = _gr1(pct=76.0)
    _shot(c, fake, room, 7.2, 57.0)
    _settle(c, room)
    _level(fake, 71.0)  # the next pass reads 5 points down: the 19 was an echo off the side
    _later(60)
    _tick(c, room)
    assert not _alerts(fake, "CS-708") and room.batch["leaky"] == 0
    assert room.batch["draw_n"] == 11  # a normal shot, judged on the fuller reading


def test_a_shot_that_starts_before_the_second_reading_joins_the_first():
    c, fake, room = _gr1(pct=76.0)
    _shot(c, fake, room, 7.2, 57.0)
    _settle(c, room)  # leaky on the first reading: read again next pass
    _shot(c, fake, room, 7.2, 37.0)  # the next shot comes first, and the two are judged as one
    assert room._draw["litres"] == pytest.approx(14.4) and "after" not in room._draw
    _settle(c, room)
    assert not _alerts(fake, "CS-708")
    _later(60)
    _tick(c, room)
    (warning,) = _alerts(fake, "CS-708")
    assert warning["message"].startswith("14.4 L of shots in a row took 39% of the reservoir (about 81 L), "
                                         "where this room's shots that size usually take 10% (about 21 L).")


def test_a_shot_long_after_one_never_judged_starts_afresh():
    c, fake, room = _gr1(pct=76.0)
    _shot(c, fake, room, 7.2, 57.0)
    _later(3600)  # no pass judged it meanwhile
    _shot(c, fake, room, 7.2, 52.0)
    assert room._draw["litres"] == pytest.approx(7.2) and room._draw["before"] == pytest.approx(57.0, abs=0.05)


def test_a_level_that_reads_nothing_once_it_settles_judges_nothing():
    c, fake, room = _gr1(pct=76.0)
    _shot(c, fake, room, 7.2, 57.0)
    fake.set_state(DISTANCE, "unavailable")
    _settle(c, room)
    assert room._draw is None and not _alerts(fake, "CS-708") and room.batch["draw_n"] == 10


def test_a_normal_shot_after_a_warning_takes_it_down():
    c, fake, room = _gr1(pct=76.0)
    _shot(c, fake, room, 7.2, 57.0)
    _settle(c, room, passes=2)
    assert room.batch["leaky"] == 1
    _shot(c, fake, room, 7.2, 52.0)  # the line is back on its clip: 7.2 L took 10 L
    _settle(c, room)
    assert room.batch["leaky"] == 0 and _dismissed(fake, f"leak_{room.slug}")
    assert room.batch["draw_n"] == 11


def test_shots_in_a_row_are_judged_together_from_the_level_before_the_first():
    c, fake, room = _gr1(pct=76.0)
    _shot(c, fake, room, 3.6, 73.5)
    _later(30)  # the next zone's shot, before the first's level has settled
    _shot(c, fake, room, 3.6, 71.0)
    assert room._draw["litres"] == pytest.approx(7.2) and room._draw["before"] == pytest.approx(76.0, abs=0.05)
    _settle(c, room)
    assert room._draw is None and room.batch["draw_n"] == 11


def test_with_its_hold_off_the_leak_check_only_warns():
    c, fake, room = _gr1(pct=76.0, leak_hold=False)
    for after in (57.0, 37.0, 15.0):
        _shot(c, fake, room, 7.2, after)
        _settle(c, room, passes=2)
        c._alerted.clear()  # every warning said again, not just once in 30 minutes
    assert room.batch["leaky"] == 3 and room.batch["leak_hold"] is None
    assert not _alerts(fake, "CS-709")
    warnings = _alerts(fake, "CS-708")
    assert len(warnings) == 3
    assert "Watering carries on: this room's leak check is set not to hold it." in warnings[0]["message"]


def test_a_factor_of_zero_switches_the_check_off():
    c, fake, room = _gr1(pct=76.0, leak_factor=0)
    for after in (57.0, 37.0):
        _shot(c, fake, room, 7.2, after)
        _settle(c, room, passes=2)
    assert not _alerts(fake, "CS-708") and not _alerts(fake, "CS-709")
    assert room.batch["draw_n"] == 10 and room.batch["draw_pct_per_l"] == USUAL  # nothing judged or learned


def test_a_room_can_set_how_far_over_its_usual_a_shot_must_go():
    c, fake, room = _gr1(pct=76.0, leak_factor=5.0)
    _shot(c, fake, room, 7.2, 57.0)  # 39 L: 3.8 times the usual 10 L, under 5
    _settle(c, room, passes=2)
    assert not _alerts(fake, "CS-708")
    c, fake, room = _gr1(pct=76.0, leak_min_l=40.0)
    _shot(c, fake, room, 7.2, 57.0)  # 29 L over the usual, under 40
    _settle(c, room, passes=2)
    assert not _alerts(fake, "CS-708")


def test_in_a_big_reservoir_a_drop_its_level_can_wobble_by_is_no_leak():
    """A 1000 L reservoir: 1% is 10 L, and a level sensor's wobble of a point or two is 10-20 L. A 2 L
    shot that reads 1.5 points down took 15 L by the level: over three times its usual, and 13 L over
    it, but within 2% of the reservoir."""
    c, fake, room = _gr1(pct=76.0)
    room.batch.update(litres_per_pct=10.0, draw_pct_per_l=0.1)  # 1 L from it a litre
    _shot(c, fake, room, 2.0, 74.5)
    _settle(c, room, passes=2)
    assert not _alerts(fake, "CS-708")
    _shot(c, fake, room, 2.0, 70.0)  # 45 L: a leak, well past the wobble
    _settle(c, room, passes=2)
    assert _alerts(fake, "CS-708")


# ---------------------------------------------------------------- what is not judged
def test_a_reservoir_filled_by_hand_is_judged_in_points_of_its_level():
    """No refill has shown what 1% of it holds: the litres a leak must take over the usual count as
    this room's own shots take the level down (10 L of shots, 7 points), and it is said in points."""
    c, fake, room = _gr1(pct=76.0)
    room.batch["litres_per_pct"] = None
    _shot(c, fake, room, 7.2, 57.0)
    _settle(c, room, passes=2)
    (warning,) = _alerts(fake, "CS-708")
    assert warning["message"].startswith(
        "A 7.2 L shot took 19% of the reservoir, where this room's shots that size usually take 5.0%. ")
    c, fake, room = _gr1(pct=76.0)
    room.batch["litres_per_pct"] = None
    _shot(c, fake, room, 7.2, 64.0)  # 12 points: 2.4 times the usual 5
    _settle(c, room, passes=2)
    assert not _alerts(fake, "CS-708")


def test_nothing_is_judged_across_a_refill():
    c, fake, room = _gr1(pct=76.0)
    _shot(c, fake, room, 7.2, 57.0)
    room.batch["started"] = _Clock.now().isoformat()  # a refill started (and finished) since the shot
    _settle(c, room, passes=2)
    assert not _alerts(fake, "CS-708") and room.batch["draw_n"] == 10


def test_a_level_that_rose_teaches_nothing():
    c, fake, room = _gr1(pct=60.0)
    _shot(c, fake, room, 7.2, 90.0)  # filled by hand meanwhile
    _settle(c, room)
    assert room.batch["draw_n"] == 10 and room._draw is None


def test_a_shot_too_small_for_the_level_to_show_teaches_nothing():
    c, fake, room = _gr1(pct=76.0)
    _shot(c, fake, room, 1.5, 75.0)
    _settle(c, room)
    assert room.batch["draw_n"] == 10


def test_a_shot_that_gave_no_water_is_forgotten():
    c, fake, room = _gr1(pct=76.0)
    c._draw_begin(room)  # the shot was cut before anything opened: no water counted
    _settle(c, room)
    assert room._draw is None


def test_without_a_level_nothing_is_judged():
    c, fake, room = _room(plan={**FLOWER, "full_mm": 0.0, "empty_mm": 0.0}, pct=76.0)
    room.batch.update(litres_per_pct=PER_PCT, draw_pct_per_l=USUAL, draw_n=10)
    _tick(c, room)
    _shot(c, fake, room, 7.2, 57.0)
    assert getattr(room, "_draw", None) is None


# ---------------------------------------------------------------- while watering is held
def _held(pct=37.0):
    c, fake, room = _gr1(pct=pct)
    room.batch.update(leaky=2, leak_hold={"at": _Clock.now().isoformat(), "litres": 7.2, "shots": 1,
                                          "took": 20.0, "usual": 5.04, "per_pct": PER_PCT})
    return c, fake, room


def test_a_zone_at_its_rescue_level_is_watered_through_a_leak_hold():
    """The plants drying out is worse than the water lost: a zone that reads at or under its rescue
    level (its emergency floor, here 40%) in any phase gets its shot, whatever shot it is."""
    c, fake, room = _held()
    topup = controller.Reason("P2 top-up", "p2_topup")
    assert c._leak_block(room, 1, {1: S(vwc=40.0)}, {1: P()}, topup) is None
    assert c._leak_block(room, 1, {1: S(vwc=41.0)}, {1: P()}, topup) == controller.LEAK_HOLD
    emergency = controller.Reason("P3 emergency", "p3_emergency")
    assert c._leak_block(room, 1, {1: S(vwc=39.0, phase="P3")}, {1: P()}, emergency) is None


def test_the_watchdog_waters_through_a_leak_hold():
    """The owner, 21 Nov 2026: "Better to *try* and get some water on the plants than to let them die."
    A zone left without water for its watchdog hours (3) in daylight, under its maintenance trigger
    (45%), is watered through the hold: by the watchdog's own shot, or by the routine shot decide()
    asks for in its place while the routine is due (a P2 top-up held for hours stays a top-up)."""
    c, fake, room = _held()
    dry = S(vwc=44.0, phase="P2", minutes_since_shot=181)
    watchdog = controller.Reason("WATCHDOG 3.0h no water (VWC 44<45)", "watchdog")
    assert c._leak_block(room, 1, {1: S(vwc=44.0)}, {1: P()}, watchdog) is None
    topup = controller.Reason("P2 top-up", "p2_topup")
    assert c._leak_block(room, 1, {1: dry}, {1: P()}, topup) is None
    for not_yet in (
        S(vwc=44.0, phase="P2", minutes_since_shot=179),  # not 3 hours yet
        S(vwc=46.0, phase="P2", minutes_since_shot=400),  # over its trigger
        S(vwc=44.0, phase="P2", minutes_since_shot=400, lights_on=False),  # the lights are off
        S(vwc=44.0, phase="P0", minutes_since_shot=400),  # the morning dryback
    ):
        assert c._leak_block(room, 1, {1: not_yet}, {1: P()}, topup) == controller.LEAK_HOLD, not_yet
    assert c._leak_block(room, 1, {1: dry}, {1: P(watchdog_hours=0)}, topup) == controller.LEAK_HOLD


def test_a_person_asking_for_a_test_shot_gets_it_through_a_leak_hold():
    c, fake, room = _held()
    test = controller.Reason("TEST shot 10 s (asked for)", "test_shot")
    assert c._leak_block(room, 1, {1: S(vwc=60.0)}, {1: P()}, test) is None


def test_a_zone_without_a_probe_reading_is_watered_on_its_timer_and_its_copy_goes_by_the_zone_it_copies():
    c, fake, room = _held()
    params = {1: P(), 2: P()}
    blind = controller.Reason("FALLBACK schedule (no live probe)", "blind_fallback")
    assert c._leak_block(room, 2, {1: S(vwc=60.0)}, params, blind) is None
    rescue = controller.Reason("COPY Z1 (VWC probe dead)", "blind_copy_rescue")  # of a rescue
    rescue.copies = 1
    assert c._leak_block(room, 2, {1: S(vwc=39.0, phase="P3")}, params, rescue) is None
    copy = controller.Reason("COPY Z1 (VWC probe dead)", "blind_copy")  # of a routine shot
    copy.copies = 1
    assert c._leak_block(room, 2, {1: S(vwc=39.0)}, params, copy) is None
    assert c._leak_block(room, 2, {1: S(vwc=50.0)}, params, copy) == controller.LEAK_HOLD


def test_switching_the_rooms_watering_off_ends_the_hold():
    c, fake, room = _held()
    _tick(c, room)
    assert room.batch["leak_hold"]
    fake.set_state(KILL, "off")
    _tick(c, room)
    assert room.batch["leak_hold"] is None and room.batch["leaky"] == 0
    assert _dismissed(fake, f"leak_hold_{room.slug}")


def test_switching_the_room_off_ends_the_hold_too():
    c, fake, room = _held()
    fake.set_state("switch.crop_steering_room_active", "off")
    _tick(c, room)
    assert room.batch["leak_hold"] is None


@pytest.mark.parametrize("setting", [{"leak_hold": False}, {"leak_factor": 0}])
def test_setting_the_check_not_to_hold_or_off_ends_the_hold(setting):
    c, fake, room = _gr1(pct=37.0, **setting)
    room.batch.update(leaky=2, leak_hold={"at": _Clock.now().isoformat(), "litres": 7.2, "took": 20.0,
                                          "usual": 5.04})
    _tick(c, room)
    assert room.batch["leak_hold"] is None and room.batch["leaky"] == 0
    assert _dismissed(fake, f"leak_hold_{room.slug}")


def test_while_held_a_normal_rescue_shot_takes_the_warning_down_but_not_the_hold_and_teaches_nothing():
    c, fake, room = _held()
    _shot(c, fake, room, 7.2, 32.0)
    _settle(c, room)
    assert room.batch["leaky"] == 0 and room.batch["leak_hold"]
    assert room.batch["draw_n"] == 10


def _due(fake, room, vwc, watered_ago_min):
    """Zone 1 in P2 reading `vwc`, under its trigger, last watered `watered_ago_min` minutes ago."""
    fake.set_state("sensor.crop_steering_vwc_zone_1", str(vwc), {"unit_of_measurement": "%"},
                   last_updated=_Clock.now(timezone.utc).isoformat())
    room.state[1].update(phase="P2", last_daily_reset=_Clock.now().date(),
                         last_shot=_Clock.now() - timedelta(minutes=watered_ago_min))


def test_in_a_pass_a_held_shot_says_why_and_nothing_opens():
    c, fake, room = _held(pct=60.0)
    _due(fake, room, 44, watered_ago_min=40)
    c.loop_once(_Clock.now())
    assert not [call for call in _switched(fake) if call[1] == "turn_on"]
    label, _attrs = fake.sets["sensor.crop_steering_zone_1_status_app"]
    assert label == f"Blocked: {controller.LEAK_HOLD}"
    (hold,) = _alerts(fake, "CS-709")  # brought back by the held shot: a restart had lost it
    assert "The last: a 7.2 L shot took 20% of the reservoir (about 41 L)" in hold["message"]


def test_in_a_pass_a_zone_at_its_rescue_level_is_watered_through_the_hold():
    c, fake, room = _held(pct=60.0)
    _due(fake, room, 38, watered_ago_min=40)
    c.loop_once(_Clock.now())
    assert (PUMP, "turn_on") in _switched(fake) and (VALVE, "turn_on") in _switched(fake)


def test_in_a_pass_a_zone_left_dry_for_its_watchdog_hours_is_watered_through_the_hold():
    c, fake, room = _held(pct=60.0)
    _due(fake, room, 44, watered_ago_min=200)  # 3 h 20 min in daylight: its watchdog is due
    c.loop_once(_Clock.now())
    assert (PUMP, "turn_on") in _switched(fake) and (VALVE, "turn_on") in _switched(fake)
    assert not _alerts(fake, "CS-207")  # watered, not left drying out


def test_the_status_sensor_says_the_usual_draw_and_the_hold():
    c, fake, room = _held(pct=60.0)
    _tick(c, room)
    _state, attrs = fake.sets["sensor.crop_steering_batch_status"]
    assert attrs["usual_draw"] == USUAL
    assert attrs["leak_hold"]["took"] == 20.0
    room.batch.update(draw_n=2, leak_hold=None)
    _tick(c, room)
    _state, attrs = fake.sets["sensor.crop_steering_batch_status"]
    assert attrs["usual_draw"] is None and attrs["leak_hold"] is None  # not learned yet


# ---------------------------------------------------------------- old installs
def test_a_feed_plan_from_an_integration_before_the_leak_check_runs_it_on_its_defaults():
    plan = controller.feed_plan(dict(FLOWER))
    assert (plan["leak_factor"], plan["leak_min_l"], plan["leak_hold"]) == (3.0, 10.0, True)
    odd = controller.feed_plan({**FLOWER, "leak_factor": "lots", "leak_min_l": -4, "leak_hold": "yes"})
    assert (odd["leak_factor"], odd["leak_min_l"], odd["leak_hold"]) == (3.0, 10.0, True)
    set_ = controller.feed_plan({**FLOWER, "leak_factor": 4.5, "leak_min_l": 25, "leak_hold": False})
    assert (set_["leak_factor"], set_["leak_min_l"], set_["leak_hold"]) == (4.5, 25.0, False)


def test_a_saved_batch_from_before_the_leak_check_loads_with_nothing_learned_or_held():
    saved = {key: value for key, value in controller.fresh_batch().items()
             if key not in ("draw_pct_per_l", "draw_n", "leaky", "leak_hold")}
    batch = controller.restore_batch(saved)
    assert (batch["draw_pct_per_l"], batch["draw_n"], batch["leaky"], batch["leak_hold"]) == (None, 0, 0, None)
    damaged = controller.restore_batch({**saved, "draw_pct_per_l": "0.7%", "draw_n": "three", "leaky": None,
                                        "leak_hold": "yes"})
    assert (damaged["draw_pct_per_l"], damaged["draw_n"], damaged["leaky"], damaged["leak_hold"]) == (
        None, 0, 0, None)
    kept = controller.restore_batch({**saved, "draw_pct_per_l": 0.7, "draw_n": 7, "leaky": 1,
                                     "leak_hold": {"at": "2026-11-21T10:58:00", "took": 20.0}})
    assert (kept["draw_pct_per_l"], kept["draw_n"], kept["leaky"]) == (0.7, 7, 1)
    assert kept["leak_hold"]["took"] == 20.0


def test_a_reservoir_two_rooms_read_the_same_level_of_is_not_judged():
    """Its level can't tell one room's shots from the other's: another room's shot while this one's
    settles would read as this one taking more."""
    c, fake, room = _gr1(pct=76.0)
    other = controller.Room("other", "other_", room.zones, room.hw, KILL, 10, 22)
    c.rooms.append(other)
    _shot(c, fake, room, 7.2, 57.0)
    assert getattr(room, "_draw", None) is None
