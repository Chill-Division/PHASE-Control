import { describe, expect, it } from "vitest";
import { createDemo } from "./demo";
import { LEVEL_STEPS, levelSeries, middleTimeFits, tankTelemetry } from "./tank-telemetry";
const room = { id: "room:", name: "Flower 2", prefix: "" };
const now = Date.parse("2026-09-08T08:00:00Z");
/** The demo without Flower 2's reservoir distances: its tank card has no level to show. */
const withoutLevel = (states: ReturnType<typeof createDemo>) => {
  states["sensor.crop_steering_feed_plan"].attributes.full_mm = 0;
  return states;
};
describe("room tank telemetry", () => {
  it("finds renamed HA descriptors by room prefix", () => {
    const states = createDemo(now);
    states["sensor.crop_steering_system_engine_config"] = {
      ...states["sensor.crop_steering_engine_config"],
      entity_id: "sensor.crop_steering_system_engine_config",
    };
    delete states["sensor.crop_steering_engine_config"];
    expect(tankTelemetry(states, room).pump.on).toBe(true);
  });
  it("reads isolated mappings, the pump and the controller's refills", () => {
    const states = createDemo(now);
    const tank = tankTelemetry(states, room);
    // Flower 2's reservoir has its distances set: 640 mm between 125 (full) and 850 (empty) is 29%,
    // what the controller acts on.
    expect(tank.level).toMatchObject({
      value: 29,
      unit: "%",
      entityId: "sensor.demo_reservoir_distance",
    });
    expect(tank.pump.on).toBe(true);
    // Flower 2's last refill as the controller recorded it: done, 20 hours ago; none running now.
    expect(tank.refill).toEqual({
      now: "Not running",
      running: false,
      lastAt: "2026-09-07T12:24:10.000Z",
      lastStopped: false,
      issue: null,
    });
    // Flower 1 has no reservoir: no level, and nothing refills it.
    const flower1 = tankTelemetry(states, { ...room, prefix: "f1_" });
    expect(flower1.level).toMatchObject({ value: null, issue: "Not mapped", entityId: null });
    expect(flower1.refill).toBeNull();
    // The controller's reading is the one: when it reads no level, the card says so, whatever the
    // sensor shows now.
    const status = states["sensor.crop_steering_batch_status"];
    states[status.entity_id] = {
      ...status,
      attributes: { ...status.attributes, level_mm: null, level_pct: null },
    };
    expect(tankTelemetry(states, room).level).toMatchObject({
      value: null,
      issue: "Unavailable",
    });
    // Before the controller reports, the sensor's own reading, worked out the same way.
    delete states[status.entity_id];
    expect(tankTelemetry(states, room).level.value).toBe(29);
    states["sensor.demo_reservoir_distance"] = {
      ...states["sensor.demo_reservoir_distance"],
      state: "unavailable",
    };
    expect(tankTelemetry(states, room).level).toMatchObject({
      value: null,
      issue: "Unavailable",
    });
  });
  it("shows a refill running, and one that stopped part-way", () => {
    const states = createDemo(now);
    const status = states["sensor.crop_steering_batch_status"];
    const last = status.attributes.last as Record<string, unknown>;
    states[status.entity_id] = {
      ...status,
      state: "dosing",
      attributes: {
        ...status.attributes,
        last: { ...last, result: "stopped: the reservoir's level sensor read nothing" },
      },
    };
    expect(tankTelemetry(states, room).refill).toMatchObject({
      now: "Dosing",
      running: true,
      lastStopped: true,
    });
    // A reservoir whose controller has not reported: not "not running", but unknown.
    delete states[status.entity_id];
    expect(tankTelemetry(states, room).refill).toEqual({
      now: null,
      running: false,
      lastAt: null,
      lastStopped: false,
      issue: "Unavailable",
    });
  });
  it("charts the level sensor the card reads, worked out as the controller does", () => {
    const states = createDemo(now);
    expect(tankTelemetry(states, room).source).toEqual({
      entityId: "sensor.demo_reservoir_distance",
      distance: { unit: "mm", fullMm: 125, emptyMm: 850 },
      minPct: 5,
      remindPct: null, // its automatic refills keep it up
      selfRefilling: true,
    });
    // With them off, a reminder to refill it by hand comes at 20%; one at its minimum never does.
    states["switch.crop_steering_auto_batches"].state = "off";
    expect(tankTelemetry(states, room).source?.remindPct).toBe(20);
    expect(tankTelemetry(states, room).source?.selfRefilling).toBe(false);
    states["sensor.crop_steering_feed_plan"].attributes.remind_pct = 5;
    expect(tankTelemetry(states, room).source?.remindPct).toBeNull();
    // Flower 1 has no reservoir level sensor to chart.
    expect(tankTelemetry(states, { ...room, prefix: "f1_" }).source).toBeNull();
  });
  it("draws the recorded level step by step, holding it where nothing was recorded", () => {
    const at = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
    const distance = {
      entityId: "sensor.distance",
      distance: { unit: "cm", fullMm: 125, emptyMm: 850 },
      minPct: 5,
      remindPct: null,
      selfRefilling: false,
    };
    const series = levelSeries(
      [
        { time: at(25 * 60), value: 78.5 }, // before the window: 785 mm, held from its start
        { time: at(12 * 60 + 3), value: 12.5 }, // refilled: full
        { time: at(12 * 60 + 2), value: 99 }, // an echo off the wall reads empty
        { time: at(12 * 60 + 1), value: 12.5 },
      ],
      distance,
      24,
      29,
      now,
    );
    expect(series).toHaveLength(LEVEL_STEPS + 1);
    expect([series[0].pct, series[70].pct]).toEqual([9, 9]);
    // The step's middle reading: one stray echo does not pull it down.
    expect(series[71].pct).toBe(100);
    // Home Assistant records a change, not a level holding still: it holds until the next.
    expect(series[143].pct).toBe(100);
    // It ends on the level the card shows now.
    expect(series[LEVEL_STEPS]).toEqual({ at: now, pct: 29 });
  });
  it("leaves the middle time out where the times would run together", () => {
    // The Overview's side column on a 1440 px screen: about 145 px of axis.
    expect(middleTimeFits(145, "6:05 PM", "6:05 AM", "Now")).toBe(false);
    // A phone's full-width card: about 175 px.
    expect(middleTimeFits(175, "6:05 PM", "6:05 AM", "Now")).toBe(true);
    expect(middleTimeFits(175, "6:05 AM", "12:05 PM", "Now")).toBe(true);
    // Shorter times, as a 24-hour clock writes them, fit a narrower chart.
    expect(middleTimeFits(145, "18:05", "06:05", "Now")).toBe(true);
  });
  it("does not guess another room's mappings", () => {
    const states = createDemo(now);
    states["sensor.crop_steering_engine_config"].attributes = {};
    const tank = tankTelemetry(states, room);
    expect(tank.level).toMatchObject({ value: null, issue: "Not mapped" });
    expect(tank.pump.on).toBeNull();
  });
  it("has no level until the reservoir's distances when full and when empty are set", () => {
    const tank = tankTelemetry(withoutLevel(createDemo(now)), room);
    expect(tank.level).toMatchObject({
      value: null,
      issue: "Not set up",
      entityId: "sensor.demo_reservoir_distance",
    });
    expect(tank.source).toBeNull();
  });
  it("distinguishes unknown from off", () => {
    const states = createDemo(now);
    states["switch.demo_pump"].state = "unavailable";
    expect(tankTelemetry(states, room).pump.on).toBeNull();
    states["switch.demo_pump"].state = "off";
    expect(tankTelemetry(states, room).pump.on).toBe(false);
  });
});
