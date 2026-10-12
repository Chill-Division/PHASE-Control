"""waiting_for: what would move a zone next, by decide()'s own rules and numbers.

The dashboard shows these as "what it's waiting for". They must never disagree with decide(): where a
condition is a reading test, decide() fires that shot (or moves that phase) exactly when the test holds.
"""

from crop_steering_engine import decide, waiting_for
from test_core import P, S


def rules(items):
    return [item["rule"] for item in items]


def by_rule(items, rule):
    return next(item for item in items if item["rule"] == rule)


def holds(item):
    now, value = item["now"], item["value"]
    return {"<": now < value, "<=": now <= value, ">": now > value, ">=": now >= value}[item["op"]]


def test_p0_waits_for_the_first_of_its_time_the_trigger_and_its_dryback():
    s, p = S(phase="P0", vwc=58, peak_vwc=62, phase_minutes=30), P(p0_max_wait_min=45, dryback_target=20)
    items = waiting_for(s, p)
    assert rules(items) == ["p0_timeout", "p0_bypass", "p0_dryback"]
    assert by_rule(items, "p0_timeout") == {"rule": "p0_timeout", "shot": False, "to": "P1", "in_min": 15.0}
    assert by_rule(items, "p0_bypass")["value"] == p.p2_threshold
    assert by_rule(items, "p0_dryback")["value"] == round(62 * 0.8, 2)
    # decide() agrees: none holds, so P0 stays; each one alone moves it to P1.
    assert decide(s, p)[0] == "P0"
    assert decide(S(phase="P0", vwc=45, peak_vwc=62, phase_minutes=30), p)[0] == "P1"
    assert decide(S(phase="P0", vwc=58, peak_vwc=62, phase_minutes=45), p)[0] == "P1"


def test_p0_ends_on_its_own_additional_dryback_from_the_lights_on_reading():
    """Athena's additional dryback: 1-5% below the lights-on reading, then the first shot. P0 used to
    wait for the P3 dryback target (30% here), which the latest-first-shot time always beat."""
    p = P(p0_max_wait_min=60, dryback_target=30, additional_dryback=3)
    def at(vwc):  # the controller's snapshot: its dryback measured from the lights-on 60.5
        return S(phase="P0", vwc=vwc, peak_vwc=60.5, dryback_pct=(60.5 - vwc) / 60.5 * 100, phase_minutes=40)

    s = at(59.0)  # 2.5% below
    assert by_rule(waiting_for(s, p), "p0_dryback")["value"] == round(60.5 * 0.97, 2)
    assert decide(s, p)[0] == "P0"
    moved = decide(at(58.6), p)  # 3.1% below
    assert moved[0] == "P1" and moved[4].startswith("P0 dryback done 3.1%")
    # Unset, P0 waits for the P3 target as before.
    unset = P(p0_max_wait_min=60, dryback_target=30)
    assert decide(at(58.6), unset)[0] == "P0"
    assert by_rule(waiting_for(s, unset), "p0_dryback")["value"] == round(60.5 * 0.7, 2)


def test_p1_ramp_shot_needs_the_moisture_and_the_spacing_and_hands_over_at_the_ceiling():
    p = P(p1_target=65, field_capacity=70, p1_time_between_min=15, p1_min_shots=3, p1_max_shots=6)
    s = S(phase="P1", vwc=62, shot_count=1, minutes_since_shot=5, ec=4, ec_smooth=4)
    items = waiting_for(s, p)
    assert rules(items) == ["p1_ramp", "p1_done", "p1_max_shots"]
    ramp = by_rule(items, "p1_ramp")
    assert (ramp["op"], ramp["value"], ramp["in_min"], ramp["shot"]) == ("<", 65, 10.0, True)
    done = by_rule(items, "p1_done")
    assert (done["value"], done["shots_left"], done["ec_max"], done["ec_now"]) == (65, 2, 5.75, 4)
    assert by_rule(items, "p1_max_shots")["shots_left"] == 5
    assert not decide(s, p)[2]  # the spacing has not passed
    assert decide(S(phase="P1", vwc=62, shot_count=1, minutes_since_shot=15, ec=4, ec_smooth=4), p)[2]


def test_the_ramp_ceiling_is_the_lower_of_the_peak_target_and_full_saturation():
    items = waiting_for(S(phase="P1", vwc=60), P(p1_target=85, field_capacity=80))
    assert by_rule(items, "p1_ramp")["value"] == 80 and by_rule(items, "p1_done")["value"] == 80


def test_p2_tops_up_exactly_below_its_trigger():
    p = P(p2_threshold=45)
    for vwc in (44.9, 45.0, 45.1):
        s = S(phase="P2", vwc=vwc, ec=6, ec_smooth=6)
        topup = by_rule(waiting_for(s, p), "p2_topup")
        assert (topup["op"], topup["value"]) == ("<", 45)
        assert decide(s, p)[2] == holds(topup), vwc  # fires exactly when the test holds


def test_p2_maintenance_shots_wait_their_spacing_after_the_last_shot():
    """Seen live on 28 Sep: the trigger raised to 70 while the zone read 67, and a maintenance shot
    fired every minute, three in four minutes, before the first had soaked down to the probe."""
    p = P(p1_target=85, field_capacity=80, p2_threshold=70, p2_time_between_min=5)
    soon = S(phase="P2", vwc=67, ec=6, ec_smooth=6, minutes_since_shot=1)
    assert not decide(soon, p)[2]
    topup = by_rule(waiting_for(soon, p), "p2_topup")
    assert (topup["value"], topup["now"], topup["in_min"]) == (70, 67, 4.0)
    later = S(phase="P2", vwc=67, ec=6, ec_smooth=6, minutes_since_shot=5)
    assert decide(later, p)[4].kind == "p2_topup"
    assert by_rule(waiting_for(later, p), "p2_topup")["in_min"] == 0.0
    # 0 is off: a shot whenever moisture reads below the trigger, and no wait to show, as before.
    off = P(p1_target=85, field_capacity=80, p2_threshold=70)
    assert decide(soon, off)[4].kind == "p2_topup"
    assert "in_min" not in by_rule(waiting_for(soon, off), "p2_topup")


def test_p2_lists_the_dilution_limit_only_with_a_known_ec():
    p = P(ec_target_p2=6)
    items = waiting_for(S(phase="P2", vwc=50, ec=5, ec_smooth=5, hours_to_lights_off=2.5), p)
    assert rules(items) == ["p2_topup", "p2_dilute", "lights_off"]
    assert (by_rule(items, "p2_dilute")["value"], by_rule(items, "lights_off")["in_min"]) == (7.2, 150.0)
    assert "p2_dilute" not in rules(waiting_for(S(phase="P2", ec=None, ec_smooth=None), p))


def test_the_settled_ec_is_the_one_compared_as_decide_uses_it():
    items = waiting_for(S(phase="P2", ec=9.5, ec_settled=5.1), P(ec_target_p2=6))
    assert by_rule(items, "p2_dilute")["now"] == 5.1


def test_p3_rescues_exactly_below_its_floor_and_waits_for_lights_on():
    # No peak seen, so no dryback to hold: the rescue level alone.
    p = P(p3_emergency_floor=40)
    for vwc in (39.9, 40.0):
        s = S(phase="P3", vwc=vwc, peak_vwc=0, lights_on=False, hours_to_lights_on=6)
        items = waiting_for(s, p)
        assert rules(items) == ["p3_emergency", "lights_on"]
        assert decide(s, p)[2] == holds(by_rule(items, "p3_emergency")), vwc
    assert by_rule(items, "lights_on")["in_min"] == 360.0


def test_p3_holds_exactly_below_the_dryback_target_and_says_which_dryback():
    """A 30% dryback from an 86.5% peak ends at 60.55%: the hold fires just under it, not at it, and
    says which dryback, from which peak."""
    p = P(p3_emergency_floor=50, dryback_target=30)
    for vwc in (60.5, 60.55, 74.2):
        s = S(phase="P3", vwc=vwc, peak_vwc=86.5, lights_on=False, hours_to_lights_on=6)
        items = waiting_for(s, p)
        assert rules(items) == ["p3_emergency", "p3_hold", "lights_on"]
        hold = by_rule(items, "p3_hold")
        assert (hold["value"], hold["dryback"], hold["peak"], hold["shot"]) == (60.55, 30, 86.5, True)
        assert decide(s, p)[2] == holds(hold), vwc


def test_p3_hold_waits_out_the_time_between_p2_shots_as_decide_does():
    p = P(p3_emergency_floor=40, p2_time_between_min=5)
    s = S(phase="P3", vwc=45, lights_on=False, minutes_since_shot=2)
    assert by_rule(waiting_for(s, p), "p3_hold")["in_min"] == 3.0
    assert decide(s, p)[2] is False
    assert decide(S(phase="P3", vwc=45, lights_on=False, minutes_since_shot=5), p)[2] is True
    # With no gap set there is nothing to wait out.
    assert "in_min" not in by_rule(waiting_for(s, P(p3_emergency_floor=40)), "p3_hold")


def test_p3_shots_wait_out_the_time_between_p3_shots_as_decide_does():
    p = P(p3_emergency_floor=40, p2_time_between_min=5, p3_time_between_min=10)
    s = S(phase="P3", vwc=35, lights_on=False, minutes_since_shot=4)
    items = waiting_for(s, p)
    assert by_rule(items, "p3_emergency")["in_min"] == 6.0
    assert by_rule(items, "p3_hold")["in_min"] == 6.0
    assert decide(s, p)[2] is False
    later = S(phase="P3", vwc=35, lights_on=False, minutes_since_shot=10)
    assert decide(later, p)[4].kind == "p3_emergency"
    # 0 turns it off, and without one a rescue never waited: nothing to wait out.
    for none in (P(p3_emergency_floor=40, p3_time_between_min=0), P(p3_emergency_floor=40)):
        assert "in_min" not in by_rule(waiting_for(s, none), "p3_emergency")


def test_a_held_plan_leaves_the_p3_hold_out():
    items = waiting_for(S(phase="P3", vwc=45, lights_on=False, steering_held=True), P())
    assert rules(items) == ["p3_emergency", "lights_on"]


def test_a_wait_already_over_reads_zero_not_negative():
    items = waiting_for(S(phase="P0", phase_minutes=90), P(p0_max_wait_min=45))
    assert by_rule(items, "p0_timeout")["in_min"] == 0.0


def test_a_held_plan_leaves_out_the_routine_shots_it_stops():
    p1 = waiting_for(S(phase="P1", vwc=50, steering_held=True), P())
    assert rules(p1) == ["p1_done", "p1_max_shots"]
    s = S(phase="P2", vwc=30, ec=6, ec_smooth=6, steering_held=True)
    assert rules(waiting_for(s, P(p2_threshold=45))) == ["lights_off"]
    assert not decide(s, P(p2_threshold=45))[2]  # decide() agrees: no top-up while held
    rescue = S(phase="P3", vwc=10, lights_on=False, steering_held=True)
    assert rules(waiting_for(rescue, P(p3_emergency_floor=40)))[0] == "p3_emergency"
    assert decide(rescue, P(p3_emergency_floor=40))[2]  # the rescue still fires


def test_with_no_ec_reading_p1_hands_over_only_after_a_shot():
    p = P(p1_target=60, field_capacity=70, p1_min_shots=0)
    s = S(phase="P1", vwc=65, shot_count=0, ec=None, ec_smooth=None)
    assert by_rule(waiting_for(s, p), "p1_done")["shots_left"] == 1
    assert decide(s, p)[0] == "P1"
    after = S(phase="P1", vwc=65, shot_count=1, ec=None, ec_smooth=None)
    assert by_rule(waiting_for(after, p), "p1_done")["shots_left"] == 0
    assert decide(after, p)[0] == "P2"
