import { describe, expect, it } from "vitest";
import { readWaiting, waitingText, type Waiting, type WaitingCondition } from "./waiting-for";
import type { EntityState } from "./types";

const AT = Date.UTC(2026, 8, 27, 7, 36);
const format = {
  number: (value: number) => String(value),
  clock: (time: number) => new Date(time).toISOString().slice(11, 16),
};
const waiting = (...conditions: Partial<WaitingCondition>[]): Waiting => ({
  at: AT,
  conditions: conditions.map((item) => ({ shot: false, to: null, rule: "", ...item })),
});
const sensor = (at: string, conditions: unknown = [{ rule: "p2_topup" }]): EntityState => ({
  entity_id: "sensor.crop_steering_zone_1_waiting_for_app",
  state: "P2",
  attributes: { at, conditions },
});

describe("reading what a zone waits for", () => {
  it("takes the controller's list while it is fresh, and nothing once it is stale or empty", () => {
    const at = new Date(AT).toISOString();
    expect(readWaiting(sensor(at), AT + 60_000)?.conditions).toHaveLength(1);
    expect(readWaiting(sensor(at), AT + 6 * 60_000)).toBeNull(); // the controller went quiet
    expect(readWaiting(sensor(at), AT - 5 * 60_000)).toBeNull(); // dated in the future
    expect(readWaiting(sensor(at, []), AT)).toBeNull(); // no probe, or the room is off
    expect(readWaiting(sensor("never"), AT)).toBeNull();
    expect(readWaiting(undefined, AT)).toBeNull();
  });
  it("takes it only for the phase shown beside it", () => {
    const at = new Date(AT).toISOString();
    expect(readWaiting(sensor(at), AT, "P2")?.conditions).toHaveLength(1);
    expect(readWaiting(sensor(at), AT, "P3")).toBeNull(); // the zone moved on since
  });
});

describe("saying what a zone waits for", () => {
  it("P0: its latest time, or sooner at the level drying reaches first", () => {
    const p0 = waiting(
      { rule: "p0_timeout", to: "P1", in_min: 30 },
      { rule: "p0_bypass", to: "P1", metric: "vwc", op: "<=", value: 70, now: 84.1 },
      { rule: "p0_dryback", to: "P1", metric: "vwc", op: "<=", value: 42.9, now: 84.1 },
    );
    expect(waitingText(p0, format)).toBe("P1 by 08:06, or sooner at VWC ≤ 70% (now 84.1%)");
  });
  it("P1: the next ramp shot and what hands over to P2", () => {
    const p1 = waiting(
      { rule: "p1_ramp", shot: true, metric: "vwc", op: "<", value: 85, now: 84.2, in_min: 0 },
      {
        rule: "p1_done",
        to: "P2",
        metric: "vwc",
        op: ">=",
        value: 85,
        now: 84.2,
        shots_left: 2,
        ec_max: 3.45,
        ec_now: 0.5,
      },
      { rule: "p1_max_shots", to: "P2", shots_left: 5 },
    );
    expect(waitingText(p1, format)).toBe(
      "ramp shot due (VWC 84.2% under 85%) · P2 at VWC ≥ 85% after 2 more shots with pwEC ≤ 3.45 (now 0.5), or after 5 more ramp shots",
    );
    const full = waiting(
      { rule: "p1_ramp", shot: true, metric: "vwc", op: "<", value: 85, now: 86, in_min: 10 },
      { rule: "p1_done", to: "P2", metric: "vwc", op: ">=", value: 85, now: 86, shots_left: 1 },
      { rule: "p1_max_shots", to: "P2", shots_left: 4 },
    );
    expect(waitingText(full, format)).toMatch(
      /^ramp shot when VWC < 85% \(now 86%\) · P2 at VWC ≥ 85% after 1 more shot, /,
    );
  });
  it("P2: the maintenance trigger, the dilution limit, and lights-off", () => {
    const p2 = waiting(
      { rule: "p2_topup", shot: true, metric: "vwc", op: "<", value: 70, now: 84.1 },
      { rule: "p2_dilute", shot: true, metric: "ec", op: ">", value: 3.84, now: 0.5 },
      { rule: "lights_off", to: "P3", in_min: 600 },
    );
    expect(waitingText(p2, format)).toBe(
      "shot when VWC < 70% (now 84.1%) · dilution if pwEC > 3.84 (now 0.5) · P3 by 17:36",
    );
    expect(waitingText(p2, { ...format, shotEstimate: AT + 90 * 60_000 })).toMatch(
      /^shot when VWC < 70% \(now 84\.1%, ≈ 09:06 at this dry-down\)/,
    );
    // A held plan stops the routine shots: lights-off is all that is left.
    expect(waitingText(waiting({ rule: "lights_off", to: "P3", in_min: 600 }), format)).toBe(
      "P3 by 17:36",
    );
  });
  it("P2: under the trigger, the time the next maintenance shot may fire", () => {
    const p2 = waiting(
      { rule: "p2_topup", shot: true, metric: "vwc", op: "<", value: 70, now: 67, in_min: 4 },
      { rule: "lights_off", to: "P3", in_min: 600 },
    );
    expect(waitingText(p2, format)).toBe("shot at 07:40 (VWC 67% under 70%) · P3 by 17:36");
    // Its time between shots has passed, or it is above the trigger: as before.
    const due = waiting({
      rule: "p2_topup",
      metric: "vwc",
      op: "<",
      value: 70,
      now: 67,
      in_min: 0,
    });
    expect(waitingText(due, format)).toBe("shot when VWC < 70% (now 67%)");
    const above = waiting({
      rule: "p2_topup",
      metric: "vwc",
      op: "<",
      value: 70,
      now: 72,
      in_min: 4,
    });
    expect(waitingText(above, format)).toBe("shot when VWC < 70% (now 72%)");
  });
  it("P3: the rescue level and lights-on", () => {
    const p3 = waiting(
      { rule: "p3_emergency", shot: true, metric: "vwc", op: "<", value: 60, now: 84.1 },
      { rule: "lights_on", to: "P0", in_min: 660 },
    );
    expect(waitingText(p3, format)).toBe("rescue shot if VWC < 60% (now 84.1%) · P0 at 18:36");
  });
  it("P3: the dryback it holds, then the rescue level beneath it", () => {
    const hold: Partial<WaitingCondition> = {
      rule: "p3_hold",
      shot: true,
      metric: "vwc",
      op: "<",
      value: 60.55,
      now: 74.2,
      dryback: 30,
      peak: 86.5,
    };
    const rescue = {
      rule: "p3_emergency",
      shot: true,
      metric: "vwc",
      op: "<",
      value: 50,
      now: 74.2,
    };
    const on = { rule: "lights_on", to: "P0", in_min: 600 };
    expect(waitingText(waiting(rescue as Partial<WaitingCondition>, hold, on), format)).toBe(
      "shot when VWC < 60.55% (now 74.2%), the 30% dryback from the 86.5% peak · rescue shot if VWC < 50% · P0 at 17:36",
    );
    // Under it, the next hold shot may still wait out the time between P3 shots.
    const under = { ...hold, now: 60.4, in_min: 3 };
    expect(waitingText(waiting(rescue as Partial<WaitingCondition>, under, on), format)).toBe(
      "shot at 07:39 (VWC 60.4% under 60.55%, the 30% dryback from the 86.5% peak) · rescue shot if VWC < 50% · P0 at 17:36",
    );
    // A rescue level at or over the dryback's end fires first, so it is the only shot to say.
    const high = { ...rescue, value: 40 } as Partial<WaitingCondition>;
    expect(waitingText(waiting(high, { ...hold, value: 28.7 }, on), format)).toBe(
      "rescue shot if VWC < 40% (now 74.2%) · P0 at 17:36",
    );
  });
  it("P3: under the rescue level, when the next rescue may fire", () => {
    const rescue: Partial<WaitingCondition> = {
      rule: "p3_emergency",
      shot: true,
      metric: "vwc",
      op: "<",
      value: 45,
      now: 44.2,
      in_min: 6,
    };
    const on = { rule: "lights_on", to: "P0", in_min: 600 };
    expect(waitingText(waiting(rescue, on), format)).toBe(
      "rescue shot at 07:42 (VWC 44.2% under 45%) · P0 at 17:36",
    );
    // Its time between P3 shots has passed, or it reads above the level: as before.
    expect(waitingText(waiting({ ...rescue, in_min: 0 }, on), format)).toBe(
      "rescue shot if VWC < 45% (now 44.2%) · P0 at 17:36",
    );
    expect(waitingText(waiting({ ...rescue, now: 61 }, on), format)).toBe(
      "rescue shot if VWC < 45% (now 61%) · P0 at 17:36",
    );
  });
});
