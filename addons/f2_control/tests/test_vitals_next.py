"""The vitals notification: no clock and no LIVE line, the room's name only when there is more than
one, watering off said when it is off, and, while the room's "Include Predictions in Notifications"
switch is on, what each zone will do next, in the words of the dashboard's "Next:"."""
from datetime import datetime

import controller
from test_controller import _build

AT = datetime(2026, 9, 27, 7, 36)
NOW = datetime(2026, 9, 27, 8, 5)
PREDICT = "switch.crop_steering_notify_predictions"
HARDWARE = {"pump": "switch.p", "mainline": "switch.m", "valves": {"1": "switch.v1"}}
KILL = "input_boolean.f2_control_enabled"
P2 = [
    {"rule": "p2_topup", "shot": True, "metric": "vwc", "op": "<", "value": 70, "now": 84.1},
    {"rule": "p2_dilute", "shot": True, "metric": "ec", "op": ">", "value": 3.84, "now": 0.5},
    {"rule": "lights_off", "to": "P3", "in_min": 600},
]


def _vitals(states=None, waiting=P2, pub=None):
    c, fake = _build({"num_zones": 1, "hardware": HARDWARE}, states=states or {KILL: ("on", {})})
    if waiting is not None:
        c.rooms[0]._waiting = {1: (waiting, AT)}
    c._maybe_notify(pub or {"default": {1: {"phase": "P2", "vwc": 84.1, "ec": 0.5}}}, NOW)
    (message,) = [d["message"] for dom, svc, d in fake.calls if dom == "persistent_notification"]
    return message.splitlines()


# ---------------------------------------------------------------- what comes next, in words
def test_p0_its_latest_time_or_sooner_at_the_level_drying_reaches_first():
    p0 = [
        {"rule": "p0_timeout", "to": "P1", "in_min": 30},
        {"rule": "p0_bypass", "to": "P1", "metric": "vwc", "op": "<=", "value": 70, "now": 84.1},
        {"rule": "p0_dryback", "to": "P1", "metric": "vwc", "op": "<=", "value": 42.9, "now": 84.1},
    ]
    assert controller.next_text(p0, AT) == "P1 by 08:06, or sooner at VWC ≤ 70% (now 84.1%)"


def test_p1_the_next_ramp_shot_and_what_hands_over_to_p2():
    p1 = [
        {"rule": "p1_ramp", "shot": True, "metric": "vwc", "op": "<", "value": 85, "now": 84.2, "in_min": 0},
        {"rule": "p1_done", "to": "P2", "metric": "vwc", "op": ">=", "value": 85, "now": 84.2,
         "shots_left": 2, "ec_max": 3.45, "ec_now": 0.5},
        {"rule": "p1_max_shots", "to": "P2", "shots_left": 5},
    ]
    assert controller.next_text(p1, AT) == (
        "ramp shot due (VWC 84.2% under 85%) · P2 at VWC ≥ 85% after 2 more shots with pwEC ≤ 3.45"
        " (now 0.5), or after 5 more ramp shots"
    )
    full = [
        {"rule": "p1_ramp", "shot": True, "metric": "vwc", "op": "<", "value": 85, "now": 86, "in_min": 10},
        {"rule": "p1_done", "to": "P2", "metric": "vwc", "op": ">=", "value": 85, "now": 86, "shots_left": 1},
    ]
    assert controller.next_text(full, AT) == "ramp shot when VWC < 85% (now 86%) · P2 at VWC ≥ 85% after 1 more shot"


def test_p2_under_the_trigger_says_when_the_next_maintenance_shot_may_fire():
    waiting = [{**P2[0], "now": 67, "in_min": 4}, P2[2]]
    assert controller.next_text(waiting, AT) == "shot at 07:40 (VWC 67% under 70%) · P3 by 17:36"
    # Its time between shots has passed, or it is above the trigger: as before.
    assert controller.next_text([{**P2[0], "now": 67, "in_min": 0}], AT) == "shot when VWC < 70% (now 67%)"
    assert controller.next_text([{**P2[0], "in_min": 4}], AT) == "shot when VWC < 70% (now 84.1%)"


def test_p2_p3_and_a_held_plan():
    assert controller.next_text(P2, AT) == (
        "shot when VWC < 70% (now 84.1%) · dilution if pwEC > 3.84 (now 0.5) · P3 by 17:36"
    )
    assert controller.next_text([{"rule": "lights_off", "to": "P3", "in_min": 600}], AT) == "P3 by 17:36"
    p3 = [
        {"rule": "p3_emergency", "shot": True, "metric": "vwc", "op": "<", "value": 60, "now": 84.1},
        {"rule": "lights_on", "to": "P0", "in_min": 660},
    ]
    assert controller.next_text(p3, AT) == "rescue shot if VWC < 60% (now 84.1%) · P0 at 18:36"
    assert controller.next_text([], AT) == ""


def test_p3_the_dryback_it_holds_then_the_rescue_level_beneath_it():
    hold = {"rule": "p3_hold", "shot": True, "metric": "vwc", "op": "<", "value": 60.55, "now": 74.2,
            "dryback": 30, "peak": 86.5}
    p3 = [
        {"rule": "p3_emergency", "shot": True, "metric": "vwc", "op": "<", "value": 50, "now": 74.2},
        hold,
        {"rule": "lights_on", "to": "P0", "in_min": 600},
    ]
    assert controller.next_text(p3, AT) == (
        "shot when VWC < 60.55% (now 74.2%), the 30% dryback from the 86.5% peak · rescue shot if VWC < 50%"
        " · P0 at 17:36"
    )
    # Under it, the next hold shot may still wait out the time between P3 shots.
    p3[1] = {**hold, "now": 60.4, "in_min": 3}
    assert controller.next_text(p3, AT) == (
        "shot at 07:39 (VWC 60.4% under 60.55%, the 30% dryback from the 86.5% peak) · rescue shot if VWC"
        " < 50% · P0 at 17:36"
    )
    # A rescue level at or over the dryback's end fires first, so it is the only shot to say.
    p3[1] = {**hold, "value": 28.7}
    p3[0] = {**p3[0], "value": 40}
    assert controller.next_text(p3, AT) == "rescue shot if VWC < 40% (now 74.2%) · P0 at 17:36"
    # A reading it could not take: the threshold alone, no empty brackets.
    assert controller.next_text([{**P2[0], "now": None}], AT) == "shot when VWC < 70%"



def test_p3_under_the_rescue_level_says_when_the_next_rescue_may_fire():
    rescue = {"rule": "p3_emergency", "shot": True, "metric": "vwc", "op": "<", "value": 45, "now": 44.2,
              "in_min": 6}
    on = {"rule": "lights_on", "to": "P0", "in_min": 600}
    assert controller.next_text([rescue, on], AT) == "rescue shot at 07:42 (VWC 44.2% under 45%) · P0 at 17:36"
    # Its time between P3 shots has passed, or it reads above the level: as before.
    assert controller.next_text([{**rescue, "in_min": 0}, on], AT) == (
        "rescue shot if VWC < 45% (now 44.2%) · P0 at 17:36"
    )
    assert controller.next_text([{**rescue, "now": 61}, on], AT) == "rescue shot if VWC < 45% (now 61%) · P0 at 17:36"

# ---------------------------------------------------------------- the notification
def test_one_room_watering_no_clock_no_live_line_and_what_comes_next():
    assert _vitals() == [
        "Z1 P2: VWC 84% EC 0.5 (FC~—) | 0.0L day | last never",
        "Next: shot when VWC < 70% (now 84.1%) · dilution if pwEC > 3.84 (now 0.5) · P3 by 17:36",
    ]


def test_with_predictions_switched_off_only_the_zone_line():
    lines = _vitals({KILL: ("on", {}), PREDICT: ("off", {})})
    assert lines == ["Z1 P2: VWC 84% EC 0.5 (FC~—) | 0.0L day | last never"]


def test_a_zone_the_controller_has_nothing_to_say_about_gets_no_next_line():
    assert _vitals(waiting=[]) == ["Z1 P2: VWC 84% EC 0.5 (FC~—) | 0.0L day | last never"]
    assert _vitals(waiting=None) == ["Z1 P2: VWC 84% EC 0.5 (FC~—) | 0.0L day | last never"]


def test_watering_off_is_said():
    assert _vitals({KILL: ("off", {}), PREDICT: ("off", {})})[0] == "Watering off"


def test_several_rooms_are_named_and_a_warning_leads():
    veg = controller.Room("veg", "veg_", {1: {}}, {"pump": None, "mainline": None, "valves": {1: "switch.veg_v1"}},
                          "input_boolean.veg", 10, 22)
    c, fake = _build({"num_zones": 1, "hardware": HARDWARE}, states={KILL: ("on", {}), PREDICT: ("off", {})})
    c.rooms.append(veg)
    veg.state = {1: dict(c.rooms[0].state[1])}  # seeded as a load would
    c._n_defaulted = 2
    pub = {"default": {1: {"phase": "P2", "vwc": 84.1, "ec": 0.5}}, "veg": {1: {"phase": "P1", "vwc": 60.0, "ec": 1.2}}}
    c._maybe_notify(pub, NOW)
    (message,) = [d["message"] for dom, svc, d in fake.calls if dom == "persistent_notification"]
    assert message.splitlines() == [
        "⚠️ 2 setpoint(s) missing → engine defaults",
        f"{c.instance_name}",
        "  Z1 P2: VWC 84% EC 0.5 (FC~—) | 0.0L day | last never",
        "veg (watering off)",
        "  Z1 P1: VWC 60% EC 1.2 (FC~—) | 0.0L day | last never",
    ]


def test_publishing_what_a_zone_waits_for_keeps_it_for_the_vitals():
    c, _ = _build({"num_zones": 1, "hardware": HARDWARE})
    room = c.rooms[0]
    controller.Controller._publish_waiting_for(room, 1, None, None, NOW)
    assert room._waiting == {1: ([], NOW)}
