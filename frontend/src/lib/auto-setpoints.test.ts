import { describe, expect, it } from "vitest";
import {
  autoStatusText,
  lastResetText,
  managedBy,
  parseAutoSetpoints,
  relearnedAt,
} from "./auto-setpoints";
import type { EntityState } from "./types";

const entity = (state: string, attributes: Record<string, unknown> = {}): EntityState => ({
  entity_id: "sensor.crop_steering_zone_1_auto_setpoints",
  state,
  attributes,
});

describe("auto setpoint status", () => {
  it("hides the surface when the supervisor sensor does not exist", () => {
    expect(parseAutoSetpoints(undefined)).toBeNull();
  });
  it("reads the documented state and attributes", () => {
    const status = parseAutoSetpoints(
      entity("tracking", {
        learned_peak: 35.9,
        gain: 0.62,
        day_rate: 0.7,
        night_rate: 0.37,
        p1_outcome: "plateau",
        last_change: "P1 target 38.0 → 36.5 %",
        managed: [
          "number.crop_steering_zone_1_p1_target_vwc",
          "number.crop_steering_zone_1_p2_vwc_threshold",
        ],
        updated: "2026-09-08T00:58:00+00:00",
        hold_days: 3,
        frozen_reason: null,
      }),
    )!;
    expect(status).toEqual({
      entityId: "sensor.crop_steering_zone_1_auto_setpoints",
      state: "tracking",
      learnedPeak: 35.9,
      gain: 0.62,
      dayRate: 0.7,
      nightRate: 0.37,
      p1Outcome: "plateau",
      lastChange: "P1 target 38.0 → 36.5 %",
      managed: [
        "number.crop_steering_zone_1_p1_target_vwc",
        "number.crop_steering_zone_1_p2_vwc_threshold",
      ],
      updated: "2026-09-08T00:58:00+00:00",
      holdDays: 3,
      frozenReason: null,
      drybackNote: null,
      p2Stop: null,
    });
  });
  it.each(["pending", "reached", "plateau", "suspect", "short"])(
    "accepts the %s P1 outcome",
    (outcome) => {
      expect(parseAutoSetpoints(entity("tracking", { p1_outcome: outcome }))!.p1Outcome).toBe(
        outcome,
      );
    },
  );
  it("reads hold days and the frozen reason as optional, untrusted attributes", () => {
    const frozen = parseAutoSetpoints(
      entity("frozen", {
        hold_days: "2",
        frozen_reason: "an armed irrigation strategy owns this room's targets",
      }),
    )!;
    expect(frozen.holdDays).toBe(2);
    expect(frozen.frozenReason).toBe("an armed irrigation strategy owns this room's targets");
    const missing = parseAutoSetpoints(entity("tracking"))!;
    expect(missing.holdDays).toBeNull();
    expect(missing.frozenReason).toBeNull();
    const malformed = parseAutoSetpoints(
      entity("tracking", { hold_days: -1, frozen_reason: { nested: true } }),
    )!;
    expect(malformed.holdDays).toBeNull();
    expect(malformed.frozenReason).toBeNull();
    expect(parseAutoSetpoints(entity("tracking", { hold_days: 1.5 }))!.holdDays).toBeNull();
    expect(parseAutoSetpoints(entity("tracking", { hold_days: 0 }))!.holdDays).toBe(0);
  });
  it("reads tonight's dryback note, what the zone gets when the target is out of reach", () => {
    const note =
      "30% dryback unreachable at this zone's uptake: about 14% tonight, with maintenance shots until 17:00";
    expect(parseAutoSetpoints(entity("tracking", { dryback_note: note }))!.drybackNote).toBe(note);
    expect(parseAutoSetpoints(entity("tracking", { dryback_note: null }))!.drybackNote).toBeNull();
    expect(parseAutoSetpoints(entity("tracking", { dryback_note: 3 }))!.drybackNote).toBeNull();
  });
  it("reads when today's plan stops maintenance shots, as a clock time or nothing", () => {
    const stop = (value: unknown) =>
      parseAutoSetpoints(entity("tracking", { p2_stop: value }))!.p2Stop;
    expect(stop("17:00")).toBe("17:00");
    expect(stop("00:30")).toBe("00:30");
    for (const bad of [null, "24:00", "5pm", "17:0", 17, undefined]) expect(stop(bad)).toBeNull();
  });
  it("treats unknown states and malformed attributes defensively", () => {
    const status = parseAutoSetpoints(
      entity("unavailable", {
        learned_peak: "n/a",
        gain: Number.NaN,
        p1_outcome: "exploded",
        last_change: "",
        managed: ["number.crop_steering_zone_1_p1_target_vwc", 5, "switch.pump", null],
        updated: 12,
      }),
    )!;
    expect(status.state).toBe("unavailable");
    expect(status.learnedPeak).toBeNull();
    expect(status.gain).toBeNull();
    expect(status.p1Outcome).toBeNull();
    expect(status.lastChange).toBeNull();
    expect(status.managed).toEqual(["number.crop_steering_zone_1_p1_target_vwc"]);
    expect(status.updated).toBeNull();
    expect(parseAutoSetpoints(entity("something-new"))!.state).toBe("unavailable");
    expect(parseAutoSetpoints(entity("off", { managed: "not-a-list" }))!.managed).toEqual([]);
  });
  it("accepts numeric strings for learned values", () => {
    expect(parseAutoSetpoints(entity("learning", { learned_peak: "36.25" }))!.learnedPeak).toBe(
      36.25,
    );
  });
  it("describes state, learned peak and last change in one line", () => {
    const status = parseAutoSetpoints(
      entity("tracking", { learned_peak: 35.9, last_change: "P1 target → 36.5 %" }),
    )!;
    expect(autoStatusText(status)).toBe(
      "Tracking · learned peak 35.9% · last change: P1 target → 36.5 %",
    );
    expect(autoStatusText(parseAutoSetpoints(entity("learning"))!)).toBe(
      "Learning · learned peak not yet known · no changes yet",
    );
    expect(autoStatusText(parseAutoSetpoints(entity("off"))!)).toBe(
      "Off · learned peak not yet known · no changes yet",
    );
  });
  it("says nothing of a judge an older controller still reports", () => {
    const older = parseAutoSetpoints(
      entity("tracking", {
        jev: "ok",
        jev_last: "14:00 no change (ec_steer level 2 (0.84))",
        jev_changed_today: "12:00 p2_shot_size 3 -> 4",
      }),
    )!;
    expect(autoStatusText(older)).toBe("Tracking · learned peak not yet known · no changes yet");
    expect(older).not.toHaveProperty("jev");
  });
  it("adds hold days while a learned peak is held, and why a supervisor is frozen", () => {
    const held = parseAutoSetpoints(entity("tracking", { learned_peak: 35.9, hold_days: 3 }))!;
    expect(autoStatusText(held)).toBe(
      "Tracking · learned peak 35.9%, held 3 days · no changes yet",
    );
    const oneDay = parseAutoSetpoints(entity("tracking", { learned_peak: 35.9, hold_days: 1 }))!;
    expect(autoStatusText(oneDay)).toMatch(/held 1 day ·/);
    // 0 means the supervisor is probing one point higher, not holding.
    const probing = parseAutoSetpoints(entity("tracking", { learned_peak: 35.9, hold_days: 0 }))!;
    expect(autoStatusText(probing)).toMatch(/learned peak 35.9%, probing higher ·/);
    const idle = parseAutoSetpoints(entity("frozen", { learned_peak: 35.9, hold_days: 0 }))!;
    expect(autoStatusText(idle)).toMatch(/learned peak 35.9% ·/);
    const frozen = parseAutoSetpoints(
      entity("frozen", { frozen_reason: "probe response looks suspect" }),
    )!;
    expect(autoStatusText(frozen)).toBe(
      "Frozen: probe response looks suspect · learned peak not yet known · no changes yet",
    );
    // A reason left over from an earlier freeze is not shown once the supervisor runs again.
    const recovered = parseAutoSetpoints(entity("tracking", { frozen_reason: "old reason" }))!;
    expect(autoStatusText(recovered)).not.toMatch(/old reason/);
  });
  it("only marks fields as managed while the supervisor is active", () => {
    const managed = ["number.crop_steering_zone_1_p1_target_vwc"];
    const tracking = parseAutoSetpoints(entity("tracking", { managed }))!;
    const frozen = parseAutoSetpoints(entity("frozen", { managed }))!;
    const off = parseAutoSetpoints(entity("off", { managed }))!;
    expect(managedBy([tracking], "number.crop_steering_zone_1_p1_target_vwc")).toBe(true);
    expect(managedBy([frozen], "number.crop_steering_zone_1_p1_target_vwc")).toBe(true);
    expect(managedBy([off], "number.crop_steering_zone_1_p1_target_vwc")).toBe(false);
    expect(managedBy([tracking], "number.crop_steering_zone_1_p2_vwc_threshold")).toBe(false);
    expect(managedBy([null, tracking], "number.crop_steering_zone_1_p1_target_vwc")).toBe(true);
  });
});

describe("a zone's last reset", () => {
  const pressed = "2026-11-24T20:12:00+00:00";
  const button = (state: string): EntityState => ({
    entity_id: "button.crop_steering_f1_zone_2_relearn_peak",
    state,
    attributes: {},
  });
  it("is when its Relearn Peak was last pressed, by its room's prefix and zone", () => {
    const states = { "button.crop_steering_f1_zone_2_relearn_peak": button(pressed) };
    expect(relearnedAt(states, "f1_", 2)).toBe(Date.parse(pressed));
    expect(relearnedAt(states, "", 2)).toBeNull(); // another room's zone 2
    expect(relearnedAt(states, "f1_", 1)).toBeNull(); // another zone
    // Home Assistant's state for a button never pressed
    const never = { "button.crop_steering_f1_zone_2_relearn_peak": button("unknown") };
    expect(relearnedAt(never, "f1_", 2)).toBeNull();
  });
  it("says when, and how long ago, or never", () => {
    const at = Date.parse(pressed);
    const when = new Date(at).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
    expect(lastResetText(null, at)).toBe("never");
    expect(lastResetText(at, at + 30_000)).toBe(`${when} (<1 min ago)`);
    expect(lastResetText(at, at + 4 * 3_600_000)).toBe(`${when} (4 h ago)`);
    expect(lastResetText(at, at + (2 * 24 + 5) * 3_600_000)).toBe(`${when} (2 d ago)`);
  });
});
