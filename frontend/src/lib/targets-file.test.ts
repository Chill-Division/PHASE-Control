import { describe, expect, it } from "vitest";
import { buildRoom, discoverRooms } from "./model";
import {
  TARGETS_FORMAT,
  exportTargets,
  loadTargets,
  readTargets,
  targetsFileName,
} from "./targets-file";
import type { EntityState, States } from "./types";

/** A room as Home Assistant has it: room defaults, a zone's own targets, steering modes. */
function room(
  prefix: string,
  zones: number[],
  targets: Record<string, number> = {},
  peakStep = 0.1,
) {
  const states: States = {};
  const put = (id: string, state: string, attributes: Record<string, unknown> = {}) => {
    states[id] = { entity_id: id, state, attributes } as EntityState;
  };
  put(`sensor.crop_steering_${prefix}engine_config`, "ready", {
    prefix,
    num_zones: zones.length,
    active_zone_ids: zones,
  });
  const numeric = (key: string, value: number, min = 0, max = 100, step = 0.5) =>
    put(`number.crop_steering_${prefix}${key}`, String(value), { min, max, step });
  numeric("lights_on_hour", 10, 0, 23, 1);
  numeric("lights_off_hour", 22, 0, 23, 1);
  numeric("pump_prime_time", 2, 0, 30, 1);
  numeric("p1_target_vwc", 65, 20, 100);
  numeric("p2_vwc_threshold", 55, 10, 85);
  numeric("substrate_volume", 6.5, 0.1, 200, 0.1);
  put(`select.crop_steering_${prefix}steering_mode`, "Vegetative", {
    options: ["Vegetative", "Generative"],
  });
  for (const zone of zones) {
    numeric(`zone_${zone}_p1_target_vwc`, targets.p1 ?? 64, 20, 100, peakStep);
    numeric(`zone_${zone}_generative_dryback_target`, targets.dryback ?? 45, 2, 60);
    numeric(`zone_${zone}_ec_target_gen_p2`, targets.ec ?? 6, 0.5, 20, 0.1);
    numeric(`zone_${zone}_plant_count`, 40, 1, 1000, 1);
    put(`select.crop_steering_${prefix}zone_${zone}_steering_mode`, "Generative", {
      options: ["Vegetative", "Generative"],
    });
  }
  return buildRoom(states, discoverRooms(states)[0]);
}

const exported = (view = room("f1_", [1], { p1: 85.3, dryback: 35, ec: 0.8 })) =>
  exportTargets(view, "2026-10-10T21:45:00.000Z");

describe("Today's targets as a file", () => {
  it("keeps each setting by name and zone, both steering modes, not the hardware", () => {
    const file = JSON.parse(exported());
    expect(file.format).toBe(TARGETS_FORMAT);
    expect(file.room_settings).toMatchObject({ p1_target_vwc: 65, lights_on_hour: 10 });
    // Each zone's mode, not the room's select, which nothing waters by.
    expect(file.room_settings).not.toHaveProperty("steering_mode");
    expect(file.zones["1"].settings).toMatchObject({
      p1_target_vwc: 85.3,
      generative_dryback_target: 35,
      ec_target_gen_p2: 0.8,
      steering_mode: "Generative",
    });
    // Pot size and plant count belong to the room's hardware (Rooms & hardware).
    expect(file.room_settings).not.toHaveProperty("substrate_volume");
    expect(file.zones["1"].settings).not.toHaveProperty("plant_count");
  });

  it("loads into a room with another prefix as a draft of only what differs", () => {
    const target = room("", [1, 2]);
    const file = readTargets(exported());
    file.room_settings.lights_on_hour = 6; // the tester's room keeps its own lights
    const loaded = loadTargets(file, target);
    expect(loaded.drafts).toEqual({
      "number.crop_steering_zone_1_p1_target_vwc": {
        value: "85.3",
        original: 64,
        label: expect.any(String),
        zone: "Zone 1",
      },
      "number.crop_steering_zone_1_generative_dryback_target": expect.objectContaining({
        value: "35",
        original: 45,
      }),
      "number.crop_steering_zone_1_ec_target_gen_p2": expect.objectContaining({ value: "0.8" }),
    });
    // The room's own lights stay this room's, said only where they differ; zone 2 is not in the file.
    expect(loaded.left).toEqual([expect.stringMatching(/light/i)]);
    expect(Object.keys(loaded.drafts).some((id) => /lights|pump/.test(id))).toBe(false);
    expect(Object.keys(loaded.drafts).some((id) => id.includes("zone_2"))).toBe(false);
    expect(loaded.same).toBeGreaterThan(0);
    expect(loaded.missingZones).toEqual([]);
  });

  it("says which zones the room lacks, what it rounds and what it cannot take", () => {
    const file = readTargets(exported(room("f1_", [1, 3], { p1: 85.3 })));
    file.zones["1"].settings.generative_dryback_target = 70; // above this room's 60
    file.zones["1"].settings.steering_mode = "Flowering";
    // This room's peak target moves in whole numbers, as the integration's does.
    const loaded = loadTargets(file, room("", [1], {}, 1));
    expect(loaded.missingZones).toEqual(["Zone 3"]);
    expect(loaded.rounded).toEqual([expect.stringMatching(/85.3 → 85$/)]);
    expect(loaded.drafts["number.crop_steering_zone_1_p1_target_vwc"].value).toBe("85");
    expect(loaded.skipped).toHaveLength(2);
    expect(loaded.skipped.join(" ")).toMatch(/takes 2 to 60/);
    expect(loaded.drafts).not.toHaveProperty(
      "number.crop_steering_zone_1_generative_dryback_target",
    );
  });

  it("refuses a file that is not a targets file, or one from a newer version", () => {
    expect(() => readTargets("not json")).toThrow(/isn’t a PHASE Control targets file/);
    expect(() => readTargets(JSON.stringify({ format: "phase-control-plan" }))).toThrow(
      /isn’t a PHASE Control targets file/,
    );
    const newer = { ...JSON.parse(exported()), version: 2 };
    expect(() => readTargets(JSON.stringify(newer))).toThrow(/newer version/);
    const broken = JSON.parse(exported());
    broken.zones["1"].settings.p1_target_vwc = { value: 60 };
    expect(() => readTargets(JSON.stringify(broken))).toThrow(/targets file/);
  });

  it("names the file after the room and the day", () => {
    expect(targetsFileName("Flower 2", "2026-10-10")).toBe(
      "phase-control-targets-flower-2-2026-10-10.json",
    );
    expect(targetsFileName("—", "2026-10-10")).toBe("phase-control-targets-room-2026-10-10.json");
  });
});
