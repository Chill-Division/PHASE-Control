"""Auto setpoints: learn a zone from its own shots and keep that zone's targets attainable. Pure, no I/O.

The engine fires every shot by its own rules. This module only decides what the zone's SETPOINTS
should be, from how the probe actually behaved:

  * Every shot's RETAINED gain is recorded: the reading right before the next shot (or 20 minutes
    on), minus the reading before it. Minutes after a shot the probe still rides a free-water spike
    that takes tens of minutes to drain, so anything sooner reads runoff as gain. Retained gains teach
    the zone's gain, its dryback rates and its ceiling.
  * P1 always tries for a higher peak. When the last couple of ramp shots stop lifting VWC, the
    substrate is full: the P1 target drops to what the zone just achieved, so the engine's own
    "target reached" rule hands over to P2. That achieved peak is the P1 target from then on.
  * After a plateau the peak is held for a few days, then probed one point higher again. A ramp that
    reaches its target while still responding means tomorrow aims one point higher.
  * A "plateau" is only believed if the ramp really climbed and did not stall far under a peak the
    zone has held before. Flat shots anywhere else are not judged while the ramp goes on: water can
    take half an hour to reach a probe, and a ramp can sit flat for a couple of shots before it
    climbs again. Only a ramp that ENDS far under that peak, or never climbed, is a delivery or probe
    problem: nothing is learned, nothing is rewritten, and the reason is published.
  * The rescue level is the operator's emergency floor and never one of these setpoints. The other
    targets keep clear of it: the maintenance trigger stays the engine's ladder above it, and a
    dryback that would end under it is planned only as deep as it lets the zone go.

`learn` is a plain JSON-safe dict so it persists in the controller's state file.
"""
import copy
import dataclasses

import curve_tracker as ct
import setpoint_supervisor as ss

SETTLE_MIN = 20.0  # minutes before a shot's retained gain is read, unless the next shot arrives first
PLATEAU_SHOTS = 2  # "a couple of shots"
PLATEAU_RISE_PTS = 0.3  # a retained gain under this is no gain...
WEAK_FRACTION = 0.3  # ...and so is one under this share of what the zone's learned gain predicts
MIN_CLIMB_PTS = 2.0  # a believable ramp climbs at least this much before it flattens
SUSPECT_DROP_PTS = 3.0  # stalling this far under a known peak is not saturation
PROBE_STEP_PTS = 1.0  # how much higher to aim when probing for a better peak
HOLD_DAYS = 3  # days to hold a plateau peak before probing above it again
ALPHA = 0.3  # EWMA weight of a new sample
MIN_RATE_SAMPLES = 30  # quiet minutes a photoperiod (or night) must contribute before its mean counts
MIN_RATE_DAYS = 2  # such days needed per light state before the dryback rate is trusted
GAIN_HEADROOM_PTS = 2.0  # only ramp shots fired at least this far under the ceiling teach the gain
QUIET_MIN = 30.0  # minutes since a shot before a dryback reading is clean (drainage has finished)
DEFAULT_BAND_PTS = 1.5  # P2 band under the peak until the gain is known
LADDER_PTS = 3.0  # the engine's ladder: the maintenance trigger sits at least this far over the rescue level
# A dryback's hold sits at least this far over the rescue level: the trigger after the planned stop is
# 2 points under the hold (setpoint_supervisor.desired) and LADDER_PTS over the rescue.
RESCUE_ROOM_PTS = 2.0 + LADDER_PTS
# What Auto setpoints writes. Never the rescue level (p3_emergency_vwc_threshold): that is the
# operator's emergency floor.
MANAGED = ("p1_target_vwc", "field_capacity", "p2_vwc_threshold")

_NUMBERS = ("peak", "gain", "day_rate", "night_rate")


def fresh():
    return {"peak": None, "gain": None, "day_rate": None, "night_rate": None, "day_n": 0, "night_n": 0,
            "day_acc": [0.0, 0], "night_acc": [0.0, 0],
            "hold_days": 0, "day": None, "ramp_start": None, "ramp": [], "pending": None,
            "outcome": "pending", "stalled_at": None, "last_change": "", "prev_peak": None, "prev_hold": 0}


def restore(saved):
    """Saved dict -> a valid learn dict. Anything malformed falls back to fresh(): never crash the engine."""
    base = fresh()
    if not isinstance(saved, dict):
        return base
    try:
        out = copy.deepcopy({k: saved.get(k, v) for k, v in base.items()})
        for k in _NUMBERS + ("ramp_start", "stalled_at", "prev_peak"):
            if out[k] is not None:
                out[k] = float(out[k])
        for k in ("day_n", "night_n", "hold_days", "prev_hold"):
            out[k] = int(out[k])
        if not isinstance(out["ramp"], list) or not all(
            isinstance(r, dict) and {"pct", "rise", "settled"} <= set(r) for r in out["ramp"]
        ):
            return base
        if out["pending"] is not None and not {"t", "pre", "pct", "ramp"} <= set(out["pending"]):
            return base
        for k in ("day_acc", "night_acc"):
            out[k] = [float(out[k][0]), int(out[k][1])]
        return out
    except (TypeError, ValueError):
        return base


def _ewma(old, new):
    return new if old is None else old + ALPHA * (new - old)


def new_day(learn, grow_day, vwc):
    """Idempotent per grow-day: a fresh ramp record, and one day off any plateau hold."""
    if learn["day"] == grow_day:
        return
    learn.update(day=grow_day, ramp_start=vwc, ramp=[], pending=None, outcome="pending", stalled_at=None)
    learn["hold_days"] = max(0, learn["hold_days"] - 1)
    for rate, n, acc in (("day_rate", "day_n", "day_acc"), ("night_rate", "night_n", "night_acc")):
        total, count = learn[acc]
        if count >= MIN_RATE_SAMPLES:  # yesterday's MEAN: transpiration swings through the day, so one
            learn[rate] = round(_ewma(learn[rate], total / count), 3)  # minute's rate says little
            learn[n] += 1
        learn[acc] = [0.0, 0]


def _flat(learn, rise, pct):
    expected = learn["gain"] * pct if learn["gain"] else 0.0
    return rise < max(PLATEAU_RISE_PTS, WEAK_FRACTION * expected)


def _settle(learn, vwc):
    """Close out the pending shot: what it RETAINED is this reading minus the one before it fired."""
    p, learn["pending"] = learn["pending"], None
    rise = vwc - p["pre"]
    flat = _flat(learn, rise, p["pct"])
    if p["ramp"]:
        learn["ramp"].append({"pct": p["pct"], "rise": round(rise, 2), "settled": round(vwc, 2), "flat": flat})
    # Gain is what a shot lifts a substrate that still has room. Near the ceiling (every P2 top-up, the end
    # of every ramp) most of the water runs off, and averaging those in shrinks the gain, which shrinks the
    # P2 band, which fires more near-ceiling shots: a runaway. Only roomy ramp shots teach it.
    roomy = learn["peak"] is None or p["pre"] < learn["peak"] - GAIN_HEADROOM_PTS
    if p["ramp"] and not flat and roomy and 0.05 <= rise / p["pct"] <= 3.0:
        learn["gain"] = round(_ewma(learn["gain"], rise / p["pct"]), 3)


def shot(learn, phase, size_pct, pre_vwc, ts):
    if pre_vwc is None or size_pct <= 0:
        return
    if learn["pending"]:  # the reading right before this shot is what the last one retained
        _settle(learn, pre_vwc)
    learn["pending"] = {"t": ts, "pre": pre_vwc, "pct": size_pct, "ramp": phase in ("P0", "P1")}


def tick(learn, vwc, phase, ts, lights_on, dryback_rate, minutes_since_shot):
    """Settle the last shot once it is old enough, and sample the dryback rate when the zone is quiet."""
    if learn["pending"] and ts - learn["pending"]["t"] >= SETTLE_MIN * 60.0:
        _settle(learn, vwc)
    if minutes_since_shot >= QUIET_MIN and dryback_rate and 0.02 <= dryback_rate <= 5.0:
        acc = learn["day_acc" if lights_on else "night_acc"]
        acc[0], acc[1] = acc[0] + dryback_rate, acc[1] + 1


def _far_under(learn, reading):
    """Too far under a peak the zone has held for the substrate to be full."""
    return learn["peak"] is not None and reading < learn["peak"] - SUSPECT_DROP_PTS


def ramp_outcome(learn, phase, vwc=None):
    """pending | reached | short | plateau | suspect. Decided once per day; learning happens here.

    `vwc` is the reading now. When the engine has just ended the ramp, its last shot has not settled
    yet, and the reading that met the target is where the ramp really ended.
    """
    if learn["outcome"] != "pending" or not learn["ramp"]:
        return learn["outcome"]
    ramp = learn["ramp"]
    top = max(r["settled"] for r in ramp)
    flat = len(ramp) >= PLATEAU_SHOTS and all(r.get("flat") for r in ramp[-PLATEAU_SHOTS:])
    start = learn["ramp_start"] if learn["ramp_start"] is not None else top
    if phase == "P1":
        # Owner, 2026-10-24: GR2's probe reads a shot 9 to 34 minutes after it fires, the drier the
        # coco the later, and its ramps sit flat for a couple of shots before climbing again. Judged
        # mid-ramp, three ramps that went on to reach their target raised CS-404. Only a plateau near a
        # peak the zone has held is decided here; the ramp's end decides the rest.
        if flat and top - start >= MIN_CLIMB_PTS and not _far_under(learn, top):
            learn.update(prev_peak=learn["peak"], prev_hold=learn["hold_days"])
            learn.update(outcome="plateau", peak=top, hold_days=HOLD_DAYS)
    elif phase in ("P2", "P3"):  # the engine ended the ramp itself
        end = top if vwc is None else max(top, vwc)
        if _far_under(learn, end) or (learn["peak"] is None and end - start < MIN_CLIMB_PTS):
            learn.update(outcome="suspect", stalled_at=end)
        elif not ramp[-1].get("flat") and not flat:  # still taking water when the target was met
            learn.update(outcome="reached", peak=max(top, learn["peak"] or 0.0))  # a plateau hold stays in force
        else:
            learn["outcome"] = "short"
            if learn["peak"] is None or top > learn["peak"]:
                learn["peak"] = top
    return learn["outcome"]


def frozen_reason(learn):
    if learn["outcome"] != "suspect":
        return None
    if learn["peak"] is not None and learn["stalled_at"] is not None and learn["stalled_at"] < learn["peak"] - SUSPECT_DROP_PTS:
        return (f"the ramp ended at {learn['stalled_at']:.1f}%, {learn['peak'] - learn['stalled_at']:.1f} points "
                f"under the peak this zone has held ({learn['peak']:.1f}%): check delivery and the probe")
    return "ramp shots are not lifting VWC: water is not reaching this probe (check the dripper, line and probe)"


def p1_target(learn, vwc, phase):
    """The P1 target this zone should hold now, or None to leave the operator's value alone."""
    if phase == "P1":
        if learn["outcome"] == "plateau":  # fail over NOW: a target the zone has already met
            return round(min(learn["peak"], vwc) - 0.1, 1)
        return None  # never move the target under a ramp that is still climbing
    if learn["peak"] is None or learn["outcome"] == "suspect":
        return None
    return round(working_peak(learn) + (PROBE_STEP_PTS if learn["hold_days"] == 0 else 0.0), 1)


def working_peak(learn):
    """The learned ceiling."""
    return learn["peak"]


def model(learn):
    """ZoneModel once the ceiling, gain and both dryback rates are learned; else None."""
    if None in (learn["peak"], learn["gain"], learn["day_rate"], learn["night_rate"]):
        return None
    if learn["day_n"] < MIN_RATE_DAYS or learn["night_n"] < MIN_RATE_DAYS:
        return None
    return ct.ZoneModel(knee=learn["peak"], gain=learn["gain"], day_rate=learn["day_rate"], night_rate=learn["night_rate"])


def rescue_allows(peak, rescue):
    """The deepest dryback (a relative %, as the P3 dryback target reads) a zone with this `peak` can be
    planned to reach above its rescue level: one whose hold sits RESCUE_ROOM_PTS over it. 0 when the
    rescue sits that close under the peak."""
    if not peak or peak <= 0:
        return 0.0
    return max(0.0, (1.0 - (rescue + RESCUE_ROOM_PTS) / peak) * 100.0)


def day_plan(learn, current, plan_ctx):
    """Today's plan for this zone (curve_tracker.plan_day), or None until the model is complete.
    Its note says when the P3 dryback target is out of reach and what the zone gets instead. A target
    that would end under the rescue level is planned only as deep as the rescue lets the zone go: the
    rescue would stop it there anyway, and maintenance shots then stop no earlier than that needs."""
    m = model(learn)
    if not (m and plan_ctx):
        return None
    target = plan_ctx["dryback_pct"]
    rescue = current["p3_emergency_vwc_threshold"]
    dryback = min(target, rescue_allows(m.knee, rescue))
    recipe = ct.Recipe(0.0, dryback, plan_ctx["p0_wait_min"], plan_ctx["p1_shot_pct"],
                       plan_ctx["p1_gap_min"], current["p2_shot_size"],
                       generative=bool(plan_ctx.get("generative", False)))
    plan = ct.plan_day(m, recipe, plan_ctx["lights_on_h"], plan_ctx["lights_off_h"], plan_ctx["start_vwc"])
    if dryback < target - 0.01:
        ends = plan.peak * (1.0 - target / 100.0)
        plan = dataclasses.replace(plan, note=(
            f"{target:g}% dryback would end at {ends:.1f}%, under the {rescue:g}% rescue level, which "
            f"stops it there: about {min(dryback, plan.achievable_dryback_pct):.0f}% tonight, with "
            f"maintenance shots until {clock(plan.p2_stop_h)}"))
    return recipe, plan


def wanted(learn, current, vwc, phase, plan_ctx):
    """suffix -> value this zone should hold now. {} until something has been learned.

    plan_ctx (optional, needs a complete model) adds the through-the-day schedule of the P2 threshold:
    {lights_on_h, lights_off_h, minutes_since_lights_on, shots_today, dryback_pct, p0_wait_min,
     p1_shot_pct, p1_gap_min, start_vwc, generative}; `generative` (the zone's steering mode, False
    when missing) sets how early maintenance shots may stop for the dryback.
    """
    target = p1_target(learn, vwc, phase)
    if target is None:
        return {}
    want = {"p1_target_vwc": target, "field_capacity": max(40.0, round(target + 2.0, 1))}
    m = model(learn)
    planned = day_plan(learn, current, plan_ctx)
    if planned:
        recipe, plan = planned
        d = ss.desired(m, recipe, plan, current["p2_shot_size"],
                       {"minutes_since_lights_on": plan_ctx["minutes_since_lights_on"],
                        "shots_today": plan_ctx["shots_today"], "feed_ec": 0.0}, ec_seen_max=0.0)
        want["p2_vwc_threshold"] = d["p2_vwc_threshold"]
    else:
        band = learn["gain"] * current["p2_shot_size"] if learn["gain"] else DEFAULT_BAND_PTS
        want["p2_vwc_threshold"] = round(working_peak(learn) - band, 1)
    # The rescue level is never moved: the trigger keeps the engine's ladder over it instead.
    want["p2_vwc_threshold"] = max(want["p2_vwc_threshold"],
                                   round(current["p3_emergency_vwc_threshold"] + LADDER_PTS, 1))
    return want


def clock(hour):
    """A plan's clock hour, which may run past midnight (past 24), as "HH:MM"."""
    minutes = round(hour * 60) % 1440
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def status(learn, enabled, dryback_note=None, p2_stop=None):
    """`dryback_note`: today's plan saying the P3 dryback target is out of reach (day_plan). `p2_stop`:
    when today's plan stops maintenance shots for the dryback, "HH:MM" (the dashboard labels it)."""
    reason = frozen_reason(learn)
    state = "off" if not enabled else "frozen" if reason else "tracking" if model(learn) else "learning"
    return state, {
        "learned_peak": learn["peak"], "gain": learn["gain"], "day_rate": learn["day_rate"],
        "night_rate": learn["night_rate"], "p1_outcome": learn["outcome"], "hold_days": learn["hold_days"],
        "frozen_reason": reason, "last_change": learn["last_change"],
        "dryback_note": dryback_note or None,
        "p2_stop": p2_stop or None,
    }


def p1_ec_gate(ec, ec_target_p1, ec_target_p2):
    """The engine only leaves P1 on "target reached" once pore EC <= 1.15 x the P1 EC target; above that
    it keeps flushing at the ceiling until max shots. After a PLATEAU that flush is pure runoff, so a P1
    EC target stricter than the zone's own P2 target must not hold the hand-over. Returns the smallest P1
    EC target that lets it through, or None: never above the P2 target, because pore EC over THAT is
    genuinely high and the engine's flush is exactly what is wanted."""
    if ec is None or not ec_target_p1 or not ec_target_p2:
        return None
    need = round(ec / 1.15 + 0.05, 1)
    return need if ec_target_p1 < need <= ec_target_p2 else None
