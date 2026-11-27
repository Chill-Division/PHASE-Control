"""A reservoir too low for the next shot and too full for its refill.

GR1, 26 Nov 2026: its 145 L fill adds about 88% to the reservoir (1.65 L a point), so a refill fits only
from 12% down, and shots stop at its 5% minimum. The 08:19 ramp shot left it at 13%. The next ramp shot
(17.2 L, about 10 points) would have taken it under its minimum, so it waited for a refill, and the
refill was refused because it would overflow (CS-703, every half hour). Only a shot lowers the level, so
nothing was watered until someone ran a refill by hand. Now that shot gives what the reservoir has above
its minimum, and the refill starts once it reads that low. A fill too big for the reservoir even at its
minimum holds watering and says so (CS-704), as any refill that cannot start does.

The shots are planned with what they really take from the reservoir: GR1's took about 1.27 times their
litres that morning (99% to 13% for 112 L of shots), and four of its eight refills from 23 Nov started at
0% to 4%, under its minimum."""
from datetime import timedelta, timezone

import pytest

import controller
import log_words
from test_nutrient_batch import (  # noqa: F401 - clock is the autouse fake clock
    FLOWER,
    PUMP,
    STATUS,
    VALVE,
    _alerts,
    _Clock,
    _level,
    _press,
    _room,
    _switched,
    _tick,
    clock,
)

PER_PCT = 1.65  # GR1's 145 L fill raised its reservoir about 88 points
DRAW = 1.27 / PER_PCT  # what its shots took that morning: 0.77 points a litre of shots
# Zone 1 here holds 128 L of substrate, so 1% is 1.28 L: 13.5% is the 17.28 L of GR1's held ramp shot.
RAMP = controller.Reason("P1 ramp VWC 70<83 | EC 1.26 under half the 3 target: 27% halved to 13.5%", "p1_ramp", True)


def _gr1(pct=13.0, auto="on", learned=True, **plan):
    c, fake, room = _room(plan={**FLOWER, **plan}, pct=pct, auto=auto)
    room.batch["litres_per_pct"] = PER_PCT
    if learned:
        room.batch.update(draw_pct_per_l=DRAW, draw_n=10)
    _tick(c, room)
    room._drawn_l = room._waiting_l = 0.0
    return c, fake, room


# ---------------------------------------------------------------- the part shot
def test_gr1_26_nov_the_shot_gives_what_the_reservoir_has_above_its_minimum():
    c, fake, room = _gr1()
    assert c._reservoir_block(room, 1, 13.5).startswith("waiting for a reservoir refill: ")  # as it was
    size, reason = c._reservoir_part(room, 1, 13.5, RAMP)
    assert size == pytest.approx(8.11)  # 10.4 L, 8 points at 0.77 a litre: from 13% to its 5% minimum
    assert room._res["pct"] - c._shot_litres(room, 1, size) * DRAW == pytest.approx(5.0, abs=0.01)
    assert str(reason) == f"{RAMP} | reservoir 13%, too low for this shot and too full for its refill: 13.5% cut to 8.11%"
    assert (reason.kind, reason.cap_exempt) == ("p1_ramp", True)  # still the rule's shot
    assert log_words.shot(reason) == (
        "ramp shot",
        "VWC 70% under the 83% peak target; halved from 27% because root-zone EC 1.26 is under half its 3 target; "
        "cut from 13.5% because the reservoir, at 13%, was too low for the whole shot and too full for its refill",
    )


def test_the_part_counts_the_shots_this_pass_has_already_taken():
    c, fake, room = _gr1(pct=20.0)
    room._drawn_l = 5.0  # an earlier zone's shot this pass: 3.85 points, not yet on the level sensor
    size, _ = c._reservoir_part(room, 1, 13.5, RAMP)
    assert room._res["pct"] - (5.0 + c._shot_litres(room, 1, size)) * DRAW == pytest.approx(5.0, abs=0.01)


def test_a_shot_that_fits_is_never_cut():
    c, fake, room = _gr1(pct=40.0)
    assert c._reservoir_part(room, 1, 13.5, RAMP) is None and c._reservoir_block(room, 1, 13.5) is None


def test_a_shot_waits_for_a_refill_that_fits_now_rather_than_being_cut():
    c, fake, room = _gr1(pct=11.0)  # 11 + 88 = 99: the refill fits, and the whole shot goes in after it
    assert c._reservoir_part(room, 1, 13.5, RAMP) is None
    assert c._reservoir_block(room, 1, 13.5).startswith("waiting for a reservoir refill: ")


def test_a_test_shot_is_never_cut():
    c, fake, room = _gr1()
    assert c._reservoir_part(room, 1, 13.5, controller.Reason("TEST shot 10 s (asked for)", "test_shot")) is None


def test_nothing_is_cut_before_a_refill_has_shown_what_one_percent_holds():
    """Until then an automatic refill is never refused as too full (_fill_overflow), so it never waits
    for a shot to make room."""
    c, fake, room = _gr1()
    room.batch["litres_per_pct"] = None
    assert c._reservoir_part(room, 1, 13.5, RAMP) is None


# ---------------------------------------------------------------- the refill after it
def test_the_refill_waits_for_the_next_shot_says_so_once_raises_nothing_and_starts_after_it(capsys):
    c, fake, room = _gr1()
    room._next_round_l = 17.28  # the next ramp shot: 13.3 points, under the minimum
    for _ in range(7):
        _tick(c, room)
    assert room.batch["step"] == "idle" and not _alerts(fake, "CS-703")
    said = [line[20:] for line in capsys.readouterr().out.splitlines() if "refill waits" in line]  # undated
    assert said == ["reservoir refill waits for the next shot to make room: the reservoir reads 13%, and its "
                    "145 L fill adds about 88%, so it could overflow"]
    _level(fake, 5.0)  # the part shot took it down to its minimum
    for _ in range(3):
        _tick(c, room)
    assert room.batch["step"] == "filling"


def test_a_refill_asked_for_by_hand_into_a_reservoir_too_full_for_it_is_still_refused():
    c, fake, room = _gr1()
    _press(c, fake, room)
    assert room.batch["step"] == "idle"
    (note,) = _alerts(fake, "CS-703")
    assert "reads 13%, and its 145 L fill adds about 88%, so it could overflow" in note["message"]


# ---------------------------------------------------------------- a fill too big even at the minimum
def test_a_fill_too_big_for_the_reservoir_even_at_its_minimum_holds_watering_and_says_so():
    c, fake, room = _gr1(pct=20.0, min_pct=15.0)  # 15 + 88 = 103: no shot makes room for it
    assert c._reservoir_part(room, 1, 13.5, RAMP) is None
    cannot = "its 145 L fill adds about 88%, more than the 85% above its 15% minimum, so even there a refill could overflow it"
    assert c._reservoir_block(room, 1, 13.5) == (
        f"reservoir too low: the reservoir reads 20%, and this shot would take it under its 15% minimum ({cannot})")
    (note,) = _alerts(fake, "CS-704")
    assert f"It can't refill by itself now: {cannot}." in note["message"]
    room._next_round_l = 17.28
    _tick(c, room)
    assert fake.sets[STATUS][1]["watering_held"] == {
        "why": "the reservoir reads 20%, and the next round of shots (17.3 L) would take it under its 15% minimum",
        "cannot": cannot,
    }


# ---------------------------------------------------------------- planned with what the shots really take
def test_shots_and_refills_are_planned_with_what_the_shots_really_take():
    """At 9.5%, a 6.4 L shot takes 3.9 points at 1.65 L a point, leaving 5.6%, but 4.9 at what GR1's
    shots really took, leaving 4.6%: under its 5% minimum."""
    c, fake, room = _gr1(pct=9.5, learned=False)
    assert c._reservoir_block(room, 1, 5.0) is None
    room._next_round_l = 6.4
    assert c._refill_due(room) is False
    room.batch.update(draw_pct_per_l=DRAW, draw_n=10)
    assert c._reservoir_block(room, 1, 5.0).startswith("waiting for a reservoir refill: ")
    assert c._refill_due(room) is True
    room.batch["draw_n"] = 2  # until three shots have taught it, what 1% holds plans alone
    assert c._reservoir_block(room, 1, 5.0) is None


def test_shots_that_take_less_than_their_litres_are_still_planned_by_what_one_percent_holds():
    c, fake, room = _gr1(pct=10.0, learned=False)
    room.batch.update(draw_pct_per_l=0.5 / PER_PCT, draw_n=10)  # drippers giving half what they are set to
    assert c._draw_rate(room) == pytest.approx(1 / PER_PCT)


def test_a_room_filled_by_hand_plans_by_what_its_shots_take_too():
    """No refill has shown what 1% holds, but the leak check has learned how far its shots take the level:
    a shot that would take it under its minimum waits, where before it waited only once the level read
    under it."""
    c, fake, room = _gr1(pct=8.0, auto="off")
    room.batch["litres_per_pct"] = None
    assert c._reservoir_block(room, 1, 5.0) == (
        "reservoir too low: the reservoir reads 8%, and this shot would take it under its 5% minimum "
        "(automatic refills are off)")


# ---------------------------------------------------------------- a whole pass
def test_in_a_pass_the_part_shot_runs_for_its_share_of_the_time_and_the_log_says_why(capsys):
    c, fake, room = _gr1()
    for entity, value in (("number.crop_steering_zone_1_p2_shot_size", "13.5"),
                          ("number.crop_steering_zone_1_drippers_per_plant", "1"),
                          ("number.crop_steering_zone_1_dripper_flow_rate", "9")):  # 40 x 9 L/h: 0.1 L/s
        fake.set_state(entity, value)
    fake.set_state("sensor.crop_steering_vwc_zone_1", "44", {"unit_of_measurement": "%"},
                   last_updated=_Clock.now(timezone.utc).isoformat())
    room.state[1].update(phase="P2", last_daily_reset=_Clock.now().date(),
                         last_shot=_Clock.now() - timedelta(minutes=40))
    c.loop_once(_Clock.now())
    assert (PUMP, "turn_on") in _switched(fake) and (VALVE, "turn_on") in _switched(fake)
    shot = [line for line in capsys.readouterr().out.splitlines() if " maintenance shot " in line]
    assert len(shot) == 1 and " maintenance shot 8.11% for 103 s (~10.3 L): " in shot[0], shot
    assert shot[0].endswith("; cut from 13.5% because the reservoir, at 13%, was too low for the whole shot "
                            "and too full for its refill")
    fired = fake.sets["sensor.crop_steering_current_decision"][1]["fired"]
    assert fired == ["Z1 P2 P2 top-up VWC 44<45 | EC unknown: base VWC watering; salt protection unverified | "
                     "reservoir 13%, too low for this shot and too full for its refill: 13.5% cut to 8.11%"]
