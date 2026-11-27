"""Zones that one valve waters together each dry back from their own peak.

GT1, 27 Nov 2026: GT1-AT (zone 1) peaked at 99.4% and GT1-BP (zone 2) at 86.4%, and the room's peak,
made one by its moisture method (Lowest), was 86.4%: a 30% dryback held both zones to one 60.5% line.
The owner: a zone's dryback is the zone's, not the room's. Two zones peaking at 80% and 100% with a
40% dryback hold at 48% and 60%, and the first zone to reach its own line waters them all, so neither
dries back more than asked. The caller passes the zone furthest into its own dryback (`dryback_vwc`,
with that zone's own peak and dryback); the absolute rules stay on the room's reading (`vwc`).
"""

import pytest

from crop_steering_engine import decide, waiting_for
from crop_steering_engine.core import dryback_reading, p3_hold_level
from test_core import P, S


def night(**snap):
    """GT1 at 22:00: the room reads 57.2% (Lowest), GT1-AT is the zone furthest into its own dryback."""
    return S(**dict(dict(phase="P3", vwc=57.2, lights_on=False, hours_to_lights_on=9, peak_vwc=99.4,
                         dryback_vwc=70.2, dryback_pct=(99.4 - 70.2) / 99.4 * 100, dryback_zone=1), **snap))


def params(**kw):
    return P(**dict(dict(dryback_target=30, p3_emergency_floor=48, p3_emergency_shot=4), **kw))


def test_the_dryback_reading_is_the_zone_furthest_into_its_own_dryback():
    assert dryback_reading(night()) == 70.2
    assert dryback_reading(S(vwc=61.0)) == 61.0  # a zone on its own valve: its own reading
    assert p3_hold_level(night(), params()) == pytest.approx(69.58)  # 30% below its own 99.4%


def test_p3_holds_a_zone_at_its_own_line_though_the_rooms_reading_is_lower():
    assert decide(night(), params())[2] is False  # GT1-AT at 70.2%, above its 69.6% line
    phase, _, fire, size, reason = decide(night(dryback_vwc=69.4), params())
    assert (phase, fire, size) == ("P3", True, 4)
    assert reason.kind == "p3_hold" and reason == "P3 hold dryback VWC 69.4<69.6 (30% of peak 99.4) Z1"


def test_the_rescue_still_goes_by_the_rooms_reading():
    reason = decide(night(vwc=47.0), params())[4]
    assert reason.kind == "p3_emergency" and reason == "P3 emergency VWC 47<48"


def test_p0_ends_when_the_first_zone_has_dried_its_amount_and_says_which():
    morning = S(phase="P0", vwc=66.0, peak_vwc=80.0, dryback_vwc=77.2,
                dryback_pct=(80.0 - 77.2) / 80.0 * 100, dryback_zone=2, phase_minutes=20)
    phase, *_ , reason = decide(morning, params(additional_dryback=3.0))
    assert phase == "P1" and reason.startswith("P0 dryback done 3.5% Z2")
    # Its bypass, an absolute level, stays on the room's reading.
    assert decide(S(phase="P0", vwc=44.0, peak_vwc=80.0, dryback_vwc=79.9, dryback_pct=0.1,
                    dryback_zone=2), params(additional_dryback=3.0))[0] == "P1"


def test_waiting_for_names_the_zone_and_its_own_reading():
    hold = next(c for c in waiting_for(night(), params()) if c["rule"] == "p3_hold")
    assert hold == {"rule": "p3_hold", "shot": True, "to": None, "metric": "vwc", "op": "<",
                    "value": 69.58, "now": 70.2, "dryback": 30, "peak": 99.4, "zone": 1}
    rescue = next(c for c in waiting_for(night(), params()) if c["rule"] == "p3_emergency")
    assert rescue["now"] == 57.2 and "zone" not in rescue
    morning = S(phase="P0", vwc=66.0, peak_vwc=80.0, dryback_vwc=79.0, dryback_pct=1.25, dryback_zone=2)
    dried = next(c for c in waiting_for(morning, params(additional_dryback=3.0)) if c["rule"] == "p0_dryback")
    assert (dried["value"], dried["now"], dried["zone"]) == (77.6, 79.0, 2)


def test_a_zone_on_its_own_valve_names_no_zone():
    items = waiting_for(S(phase="P3", vwc=61.0, peak_vwc=86.5, lights_on=False), params())
    assert all("zone" not in item for item in items)
    reason = decide(S(phase="P3", vwc=60.4, peak_vwc=86.5, lights_on=False), params())[4]
    assert reason == "P3 hold dryback VWC 60.4<60.5 (30% of peak 86.5)"
