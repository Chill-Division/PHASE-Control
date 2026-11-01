"""How pore EC sizes a routine shot, said where the shot is.

decide() scales ramp and maintenance shots by pore EC against the phase's EC target (ec_adjust): under
half the target a shot goes in halved. GR1, 2 Nov 2026: the ramp was set to start at 5% and every
shot went in at 2.5%, because the room's EC read 0.62 against a target of 5, and nothing said so. Now
the shot's reason says it, and ec_sizing() gives the dashboard the factor beside the size it is set to."""

import pytest

from crop_steering_engine import decide, ec_adjust, ec_scale, ec_sized, ec_sizing, next_shot_size
from test_core import P, S


@pytest.mark.parametrize(
    "ec, factor",
    # Against a target of 6: over 1.5 times, over 1.2 times, over it, 0.8 to 1 times, under 0.8 times,
    # under half; no reading leaves the shot as set.
    [(12.1, 2.0), (8, 1.5), (7, 1.2), (6, 1.0), (4.9, 1.0), (4.7, 0.7), (2.9, 0.5), (None, 1.0)],
)
def test_ec_scale_is_the_factor_ec_adjust_sizes_a_shot_by(ec, factor):
    assert ec_scale(ec, 6) == factor
    assert ec_adjust(5, ec, 6) == pytest.approx(5 * factor)


def test_a_shot_ec_sized_says_by_how_much_and_why():
    assert ec_sized(5, 0.62, 5) == "EC 0.62 under half the 5 target: 5% halved to 2.5%"
    assert ec_sized(5.5, 0.62, 5) == "EC 0.62 under half the 5 target: 5.5% halved to 2.8%"
    assert ec_sized(5, 4.5, 6) == "EC 4.5 under 0.8x the 6 target: 5% cut to 3.5%"
    assert ec_sized(5, 6.6, 6) == "EC 6.6 over the 6 target: 5% raised to 6%"
    assert ec_sized(5, 8, 6) == "EC 8 over 1.2x the 6 target: 5% raised to 7.5%"
    assert ec_sized(5, 9.5, 6) == "EC 9.5 over 1.5x the 6 target: 5% doubled to 10%"


@pytest.mark.parametrize("ec", [5, 4.8, None, float("nan")])
def test_a_shot_that_goes_in_as_set_says_nothing_about_ec(ec):
    assert ec_sized(5, ec, 5) == ""


def test_gr1s_ramp_shot_says_ec_halved_it():
    # GR1 on 2 Nov 2026: the ramp's first shot set to 5%, the room's EC 0.62 against a P1 target of 5.
    p = P(p1_initial=5, p1_incr=0.5, ec_target_p1=5, p1_target=80, field_capacity=85)
    s = S(phase="P1", vwc=52, ec=0.62, ec_smooth=0.62, shot_count=0)
    phase, _, fire, size, reason = decide(s, p)
    assert (phase, fire, size, reason.kind) == ("P1", True, 2.5, "p1_ramp")
    assert reason == "P1 ramp VWC 52<80 | EC 0.62 under half the 5 target: 5% halved to 2.5%"
    # Its third shot, set to 6%.
    _, _, _, size, reason = decide(S(phase="P1", vwc=56, ec=0.62, shot_count=2), p)
    assert size == 3.0 and reason.endswith("| EC 0.62 under half the 5 target: 6% halved to 3%")


def test_a_maintenance_shot_ec_sized_says_so():
    p = P(p2_shot_size=5, ec_target_p2=6)
    _, _, fire, size, reason = decide(S(phase="P2", vwc=40, ec=4.5, ec_smooth=4.5), p)
    assert fire and size == 3.5
    assert reason == "P2 top-up VWC 40<45 | EC 4.5 under 0.8x the 6 target: 5% cut to 3.5%"


def test_a_shot_that_goes_in_as_set_keeps_its_reason():
    _, _, fire, size, reason = decide(S(phase="P2", vwc=40, ec=6), P(p2_shot_size=5, ec_target_p2=6))
    assert (fire, size, reason) == (True, 5, "P2 top-up VWC 40<45")


def test_ec_sizing_gives_the_dashboard_each_phases_factor():
    p = P(ec_target_p1=5, ec_target_p2=6)
    assert ec_sizing(S(ec=0.62), p) == {
        "ec": 0.62,
        "P1": {"target": 5, "scale": 0.5},
        "P2": {"target": 6, "scale": 0.5},
    }
    # The settled reading, as decide() reads it.
    assert ec_sizing(S(ec=9.9, ec_settled=4.5), p) == {
        "ec": 4.5,
        "P1": {"target": 5, "scale": 1.0},
        "P2": {"target": 6, "scale": 0.7},
    }
    # No reading: every shot goes in as set.
    assert ec_sizing(S(ec=None, ec_smooth=None), p) is None


def test_with_ec_sizing_off_every_routine_shot_goes_in_as_set():
    # The room's EC Shot Sizing switch off (ZoneParams.ec_sizing): GR1's probes read bulk EC, so its
    # ramp goes in as set, 5%, and nothing is said of EC.
    p = P(p1_initial=5, p1_incr=0.5, ec_target_p1=5, p1_target=80, field_capacity=85, ec_sizing=False)
    _, _, fire, size, reason = decide(S(phase="P1", vwc=52, ec=0.62, shot_count=0), p)
    assert (fire, size, reason) == (True, 5, "P1 ramp VWC 52<80")
    topup = P(p2_shot_size=5, ec_sizing=False)
    assert decide(S(phase="P2", vwc=40, ec=0.62), topup)[2:] == (True, 5, "P2 top-up VWC 40<45")
    assert next_shot_size(S(phase="P1", vwc=52, ec=0.62, shot_count=2), p) == 6
    assert ec_sizing(S(ec=0.62), p) == {
        "ec": 0.62,
        "P1": {"target": 5, "scale": 1.0},
        "P2": {"target": 6, "scale": 1.0},
    }


def test_the_other_ec_rules_carry_on_with_ec_sizing_off():
    # A flush at the maximum EC is not shot sizing: it fires as before.
    _, _, fire, size, reason = decide(S(phase="P2", vwc=50, ec=10), P(ec_sizing=False))
    assert fire and reason.kind == "flush_high_ec" and size == 9.0
