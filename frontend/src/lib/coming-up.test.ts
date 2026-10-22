import { describe, expect, it } from "vitest";
import { comingUp } from "../components/overview-parts";
import type { Lane } from "../components/day-timeline";
import type { GrowDay } from "./day-timeline";

const H = 3_600_000;
const START = Date.parse("2026-10-19T07:00:00");
const at = (hour: number) => START + hour * H;
/** 07:00 lights on, 01:00 lights off, the next lights-on at 07:00. */
const DAY: GrowDay = { start: START, end: at(24), lightsOff: at(18) };
const NOW = at(10.87); // 17:52

/** A zone's lane, as much of it as Coming up reads. */
function lane(name: string, extra: Partial<Record<keyof Lane, unknown>> = {}): Lane {
  return {
    zone: { name },
    stopped: null,
    target: 78.2,
    p1Shots: 6,
    phase: "P2",
    next: { at: null, basis: "settling" },
    projection: {
      points: [
        { time: NOW, value: 78.3, phase: "P2" },
        { time: at(18), value: 77.9, phase: "P3" },
      ],
      shots: [12.6, 14.3, 16.05, 17.8].map((hour) => ({
        time: at(hour),
        phase: "P2",
        size: 4,
        emergency: false,
      })),
    },
    ...extra,
  } as unknown as Lane;
}
const rows = (lanes: Lane[]) =>
  comingUp(lanes, DAY, NOW).map((item) => [
    new Date(item.time).toTimeString().slice(0, 5),
    item.who,
    item.text,
  ]);

describe("Coming up", () => {
  it("lists the shots the zone's projection expects, as its chart draws them", () => {
    // GT1, 2026-10-19 17:52: two minutes after a shot its next one could not be timed from the
    // readings yet, and the list said only Into P3 and Lights off.
    expect(rows([lane("GT1")])).toEqual([
      ["19:36", "GT1", "Maintenance shot (predicted)"],
      ["21:18", "GT1", "Maintenance shot (predicted)"],
      ["23:03", "GT1", "Maintenance shot (predicted)"],
      ["00:48", "GT1", "Maintenance shot (predicted)"],
      ["01:00", "GT1", "Into P3, the overnight dryback (predicted)"],
      ["01:00", "Room", "Lights off"],
    ]);
  });
  it("lets a next shot timed from the readings stand for the projection's first", () => {
    const timed = lane("GT1", { next: { at: at(12.2), basis: "dry-down" } });
    expect(rows([timed]).slice(0, 3)).toEqual([
      ["19:12", "GT1", "A shot once it dries to 78.2% (estimate)"],
      ["21:18", "GT1", "Maintenance shot (predicted)"],
      ["23:03", "GT1", "Maintenance shot (predicted)"],
    ]);
  });
  it("says a top-up drawn as shots minutes apart once, and none beside a shot due now", () => {
    const burst = (hour: number) => [hour, hour + 0.03, hour + 0.06];
    const projection = {
      points: [{ time: NOW, value: 75, phase: "P2" }],
      shots: [...burst(10.88), ...burst(12.1)].map((hour) => ({
        time: at(hour),
        phase: "P2",
        size: 4,
        emergency: false,
      })),
    };
    expect(rows([lane("GT1", { projection })]).slice(0, 2)).toEqual([
      ["17:52", "GT1", "Maintenance shot (predicted)"],
      ["19:06", "GT1", "Maintenance shot (predicted)"],
    ]);
    const due = lane("GT1", { projection, next: { at: NOW, basis: "due" } });
    expect(rows([due]).slice(0, 2)).toEqual([
      ["17:52", "GT1", "A shot now: at or under its 78.2% trigger"],
      ["19:06", "GT1", "Maintenance shot (predicted)"],
    ]);
  });
  it("agrees with the controller: its own trigger, and the wait it has left", () => {
    // GT4, 2026-10-19 17:55: Coming up said "A shot now: at or under its 70% trigger" (the
    // setting) while the zone's card said "Next: shot at 17:56 (VWC 68.1% under 69%)": the
    // controller had moved the trigger for EC and was waiting out the time between shots.
    const waiting = (now: number, inMin = 0) => ({
      at: NOW,
      conditions: [
        { rule: "p2_topup", shot: true, to: null, op: "<", value: 69, now, in_min: inMin },
      ],
    });
    const gt4 = (now: number, next: unknown, inMin = 0) =>
      lane("GT4", {
        target: 70,
        zone: { name: "GT4", phase: "P2", waiting: waiting(now, inMin) },
        next,
        projection: { points: [], shots: [] },
      });
    expect(rows([gt4(68.1, { at: NOW, basis: "due" }, 1)])[0]).toEqual([
      "17:53",
      "GT4",
      "A shot: VWC 68.1% is under its 69% trigger",
    ]);
    // Above the controller's trigger, the dashboard's estimate is timed to it, not the setting.
    const fit = { rate: 2, from: { time: NOW, value: 72 }, at: NOW };
    expect(rows([gt4(72, { at: at(11.5), basis: "dry-down", fit })])[0]).toEqual([
      "19:22",
      "GT4",
      "A shot once it dries to 69% (estimate)",
    ]);
    // Under the setting but not under the controller's trigger: no shot now.
    expect(rows([gt4(69.5, { at: NOW, basis: "due" })]).map((row) => row[2])).toEqual([
      "Lights off",
    ]);
  });
  it("expects no shot from a zone that is stopped or held", () => {
    // Held, the controller still says what it waits for (here a P2 top-up under its trigger).
    const waiting = {
      at: NOW,
      conditions: [{ rule: "p2_topup", shot: true, to: null, op: "<", value: 69, now: 68 }],
    };
    for (const quiet of [
      lane("GT1", { stopped: "the room is Watching only" }),
      lane("GT1", { next: { at: null, basis: "held" } }),
      lane("GT4", {
        zone: { name: "GT4", phase: "P2", waiting },
        next: { at: null, basis: "held" },
      }),
    ])
      expect(rows([quiet]).map((row) => row[2])).toEqual([
        "Into P3, the overnight dryback (predicted)",
        "Lights off",
      ]);
  });
  it("says once what the zones do together, and numbers the ramp-up", () => {
    const ramp = {
      phase: "P1",
      p1Shots: 2,
      next: { at: at(10.9), basis: "p1-interval" },
      projection: {
        points: [{ time: NOW, value: 60, phase: "P1" }],
        shots: [10.9, 11.15, 11.4].map((hour) => ({
          time: at(hour),
          phase: "P1",
          size: 2,
          emergency: false,
        })),
      },
    };
    expect(rows([lane("Zone 1", ramp), lane("Zone 2", ramp)]).slice(0, 4)).toEqual([
      ["17:54", "Zone 1", "Ramp-up shot 3"],
      ["17:54", "Zone 2", "Ramp-up shot 3"],
      ["18:09", "All zones", "Ramp-up shot 4 (predicted)"],
      ["18:24", "All zones", "Ramp-up shot 5 (predicted)"],
    ]);
  });
  it("names an overnight shot as the hold or a rescue", () => {
    const night = lane("GT1", {
      phase: "P3",
      next: { at: null, basis: "night" },
      projection: {
        points: [{ time: NOW, value: 70, phase: "P3" }],
        shots: [
          { time: at(20), phase: "P3", size: 3, emergency: false },
          { time: at(22), phase: "P3", size: 3, emergency: true },
        ],
      },
    });
    expect(rows([night]).map((row) => row[2])).toEqual([
      "Lights off",
      "Dryback hold shot (predicted)",
      "Rescue shot (predicted)",
    ]);
  });
});
