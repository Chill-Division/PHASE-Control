"""P3 holds the overnight dryback at its target.

P3 used to water only below the rescue level, and the dryback target was read only by P2's early move
to P3, which can start the dryback sooner but never stop it. A night that dried faster than the day
went on past the target to the rescue level (seen live on GR2: a 30% dryback from an 86.5% peak should
end at 60.55%; drying 2.3 points an hour from 74.2% at 21:05, the zone was on course for about 51% by
07:00, with the next shot at the 50% rescue level). Now each time a P3 zone dries to the day's peak
less the dryback target it gets a rescue-sized shot, the time between P3 shots apart.
"""

import pytest

from crop_steering_engine import CAP_EXEMPT, decide, zone_status_label
from crop_steering_engine.core import p3_hold_level
from test_core import P, S

GR2 = dict(peak_vwc=86.5, lights_on=False, hours_to_lights_on=6)


def night(**snap):
    return S(phase="P3", **dict(GR2, **snap))


def params(**kw):
    return P(**dict(dict(dryback_target=30, p3_emergency_floor=50, p3_emergency_shot=2), **kw))


def test_the_hold_level_is_the_peak_less_the_relative_dryback():
    assert p3_hold_level(night(vwc=70), params()) == pytest.approx(60.55)
    assert p3_hold_level(night(vwc=70, peak_vwc=0), params()) is None


def test_a_zone_that_dries_to_its_dryback_target_gets_a_rescue_sized_shot():
    phase, _, fire, size, reason = decide(night(vwc=60.4), params())
    assert (phase, fire, size) == ("P3", True, 2)
    assert reason.kind == "p3_hold" and reason == "P3 hold dryback VWC 60.4<60.5 (30% of peak 86.5)"
    assert reason.cap_exempt is False and CAP_EXEMPT["p3_hold"] is False


@pytest.mark.parametrize("vwc", [74.2, 60.6, 60.55])
def test_nothing_fires_above_or_at_the_dryback_target(vwc):
    result = decide(night(vwc=vwc), params())
    assert result[2] is False and result[4].kind == "idle"


def test_below_the_rescue_level_the_rescue_fires_first_and_stays_exempt():
    result = decide(night(vwc=49), params())
    assert result[2] is True and result[4].kind == "p3_emergency" and result[4].cap_exempt is True
    # A rescue level above the dryback's end cuts the dryback short, as it always has.
    result = decide(night(vwc=62), params(p3_emergency_floor=63))
    assert result[4].kind == "p3_emergency"


def test_without_a_p3_time_between_shots_it_waits_the_p2_one_as_before():
    p = params(p2_time_between_min=5)
    assert decide(night(vwc=60, minutes_since_shot=4), p)[2] is False
    assert decide(night(vwc=60, minutes_since_shot=5), p)[2] is True
    # Nor did a rescue wait for anything.
    assert decide(night(vwc=49, minutes_since_shot=1), p)[4].kind == "p3_emergency"


def test_the_p3_time_between_shots_spaces_the_hold_and_the_rescue_alike():
    """Seen live on GR2: three hold shots a few minutes apart, each before the last had reached the
    probe, lifted the zone about 6 points past its hold. A rescue waited for nothing at all: a zone
    still reading under the rescue level after one got another every minute."""
    p = params(p2_time_between_min=5, p3_time_between_min=10)
    for vwc, kind in ((60, "p3_hold"), (49, "p3_emergency")):
        assert decide(night(vwc=vwc, minutes_since_shot=9), p)[2] is False, kind
        assert decide(night(vwc=vwc, minutes_since_shot=10), p)[4].kind == kind


def test_a_p3_time_between_shots_of_0_waits_for_nothing():
    p = params(p2_time_between_min=5, p3_time_between_min=0)
    assert decide(night(vwc=60, minutes_since_shot=1), p)[4].kind == "p3_hold"
    assert decide(night(vwc=49, minutes_since_shot=1), p)[4].kind == "p3_emergency"


def test_the_daily_water_limit_holds_it_but_never_the_rescue():
    spent = dict(daily_vol=300)
    result = decide(night(vwc=60, **spent), params(max_daily_volume=300))
    assert result[2] is False and result[4].kind == "block_daily_cap"
    result = decide(night(vwc=49, **spent), params(max_daily_volume=300))
    assert result[2] is True and result[4].kind == "p3_emergency"


def test_a_held_plan_stops_it_but_never_the_rescue():
    assert decide(night(vwc=60, steering_held=True), params())[2] is False
    result = decide(night(vwc=49, steering_held=True), params())
    assert result[2] is True and result[4].kind == "p3_emergency"


def test_nothing_is_held_before_a_peak_has_been_seen():
    assert decide(night(vwc=55, peak_vwc=0), params())[2] is False


def test_only_p3_holds_the_dryback():
    # The same reading in P2 is above its trigger, and in P0 is the morning's own dryback.
    assert decide(S(phase="P2", vwc=60, peak_vwc=86.5, minutes_since_shot=99), params(p2_threshold=55))[2] is False
    assert decide(S(phase="P0", vwc=60, peak_vwc=86.5, phase_minutes=5), params(p2_threshold=55))[2] is False


def test_lights_off_moves_a_zone_already_past_its_target_to_p3_and_holds_it_at_once():
    phase, _, fire, _, reason = decide(S(phase="P2", vwc=60, lights_on=False, peak_vwc=86.5), params(p2_threshold=55))
    assert (phase, fire, reason.kind) == ("P3", True, "p3_hold")
    assert reason == "lights-off -> P3 | P3 hold dryback VWC 60.0<60.5 (30% of peak 86.5)"


def test_lights_on_ends_the_night_without_a_hold_shot():
    phase, _, fire, _, _ = decide(night(vwc=60, lights_on=True, lights_just_on=True), params(p2_threshold=55))
    assert (phase, fire) == ("P0", False)


def test_the_zone_label_says_it_is_holding_the_dryback_not_an_emergency():
    _, _, fire, _, reason = decide(night(vwc=60.4), params())
    assert zone_status_label("P3", fire, None, False, reason) == "Holding dryback"
    _, _, fire, _, reason = decide(night(vwc=49), params())
    assert zone_status_label("P3", fire, None, False, reason) == "Emergency"
