import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  alignBands,
  appendLive,
  atHour,
  changedBy,
  changeSentence,
  compareDays,
  dayTrace,
  dryDown,
  duration,
  earlierDays,
  earlierEntities,
  earlierTraces,
  growDay,
  joinRows,
  levels,
  dayDryback,
  morningDryback,
  nextShot,
  NOT_REPORTING,
  logbookEntries,
  openSeconds,
  peopleByUser,
  phaseAt,
  phaseBands,
  phaseTargets,
  reachedHour,
  readings,
  readingsPath,
  recordedGaps,
  revisionAt,
  setpointChanges,
  setpointSteps,
  stoppedTargets,
  timelineEntities,
  typicalDay,
  unprojected,
  valueAt,
  valveShots,
  zoneBlocks,
  type Block,
  type DayTrace,
  type GrowDay,
  type PhaseBand,
  type Reading,
  type Shot,
  type TimelineRow,
} from "./day-timeline";
import { createDemo, demoDay, demoLogbook } from "./demo";
import { buildRoom, discoverRooms } from "./model";
import type { EntityState } from "./types";

const at = (time: string, date = "2026-09-22") => Date.parse(`${date}T${time}Z`);
const row = (state: string, time: number, attributes?: Record<string, unknown>): TimelineRow => ({
  state,
  time,
  ...(attributes ? { attributes } : {}),
});
const decision = (time: number, fired: string[] = [], blocked: string[] = []) =>
  row(fired[0] ?? blocked[0] ?? "Holding — all zones in band", time, { fired, blocked });

describe("grow day", () => {
  const local = (day: number, hour: number, minute = 0) =>
    new Date(2026, 8, day, hour, minute).getTime();
  it("runs from the last lights-on to the next, lights-off inside it", () => {
    expect(growDay(10, 22, local(23, 14))).toEqual({
      start: local(23, 10),
      lightsOff: local(23, 22),
      end: local(24, 10),
    });
    // Before lights-on it is still yesterday's grow-day; at lights-on today's begins.
    expect(growDay(10, 22, local(23, 9, 59))!.start).toBe(local(22, 10));
    expect(growDay(10, 22, local(23, 10))!.start).toBe(local(23, 10));
  });
  it("crosses midnight with the lights and takes fractional hours", () => {
    const night = { start: local(23, 20), lightsOff: local(24, 8), end: local(24, 20) };
    expect(growDay(20, 8, local(23, 23))).toEqual(night);
    expect(growDay(20, 8, local(24, 7))).toEqual(night);
    expect(growDay(10.5, 22.25, local(23, 12))).toEqual({
      start: local(23, 10, 30),
      lightsOff: local(23, 22, 15),
      end: local(24, 10, 30),
    });
  });
  it("needs a real photoperiod", () => {
    for (const [on, off] of [
      [null, 22],
      [10, null],
      [10, 10],
      [24, 10],
      [-1, 10],
    ])
      expect(growDay(on, off, local(23, 12))).toBeNull();
  });
});

// Flower 2 on 23 September 2026 (UTC; lights-on 10:00 NZST is 22:00Z), as the recorder returned it.
const START = at("22:00:00");
const decisions = [
  decision(START),
  decision(at("22:01:18.029"), ["Z2 P3 P3 emergency VWC 20<20"]),
  decision(at("22:02:18.786")),
  decision(at("22:07:56.822"), [
    "Z1 P1 P0 bypass VWC 25<=rewater 30 | P1 ramp VWC 25<36",
    "Z3 P1 P0 bypass VWC 32<=rewater 40 | P1 ramp VWC 32<49",
  ]),
  decision(at("22:08:57.611")),
  decision(at("22:14:36.300"), ["Z2 P1 P1 ramp VWC 30<40"]),
  decision(at("22:18:13.309"), ["Z1 P1 P1 ramp VWC 27<36"]),
  decision(at("22:19:13.984")),
];

describe("phase bands", () => {
  it("draws each phase as recorded", () => {
    const zone1 = [row("P3", START), row("P0", at("22:02:18.694")), row("P1", at("22:07:56.719"))];
    const bands = phaseBands(zone1, START, at("22:30:00"));
    expect(bands).toEqual([
      { phase: "P3", start: START, end: at("22:02:18.694") },
      { phase: "P0", start: at("22:02:18.694"), end: at("22:07:56.719") },
      { phase: "P1", start: at("22:07:56.719"), end: at("22:30:00") },
    ]);
    expect(phaseAt(bands, at("22:05:00"))).toBe("P0");
    expect(phaseAt(bands, at("22:31:00"))).toBeNull();
  });
  it("leaves a restart as a gap, joins repeats and clips to the day", () => {
    const restart = [
      row("P3", at("21:00:00")),
      row("unavailable", at("21:09:00")),
      row("P3", at("21:10:00")),
      row("P3", at("21:30:00")),
    ];
    expect(phaseBands(restart, at("21:05:00"), START)).toEqual([
      { phase: "P3", start: at("21:05:00"), end: at("21:09:00") },
      { phase: "P3", start: at("21:10:00"), end: START },
    ]);
    expect(phaseBands(undefined, START, at("23:00:00"))).toEqual([]);
  });
});

describe("shots", () => {
  it("names each shot by what the controller posted after the valve closed", () => {
    const row1 = [
      row("off", START),
      row("on", at("22:03:22.638")),
      row("off", at("22:04:47.630")),
      row("on", at("22:15:40.100")),
      row("off", at("22:18:11.000")),
    ];
    const shots = valveShots(row1, decisions, 1, START, at("22:30:00"));
    expect(shots).toEqual([
      {
        start: at("22:03:22.638"),
        end: at("22:04:47.630"),
        open: false,
        phase: "P1",
        reason: "P0 bypass VWC 25<=rewater 30 | P1 ramp VWC 25<36",
      },
      {
        start: at("22:15:40.100"),
        end: at("22:18:11.000"),
        open: false,
        phase: "P1",
        reason: "P1 ramp VWC 27<36",
      },
    ]);
    // The phase changed in the same post, so the first P1 shot sits in the recorded P0 band.
    const bands = phaseBands(
      [row("P3", START), row("P0", at("22:02:18.694")), row("P1", at("22:07:56.719"))],
      START,
      at("22:30:00"),
    );
    expect(phaseAt(bands, shots[0].start)).toBe("P0");
  });
  it("starts a shot open at lights-on at the window, and keeps one still running open", () => {
    const row2 = [
      row("on", START),
      row("off", at("22:01:16.000")),
      row("on", at("22:12:03.000")),
      row("off", at("22:14:34.000")),
      row("on", at("22:29:00.000")),
    ];
    const shots = valveShots(row2, decisions, 2, START, at("22:30:00"));
    expect(shots.map(({ phase, reason, open }) => ({ phase, reason, open }))).toEqual([
      { phase: "P3", reason: "P3 emergency VWC 20<20", open: false },
      { phase: "P1", reason: "P1 ramp VWC 30<40", open: false },
      { phase: null, reason: null, open: true },
    ]);
    expect(shots[0].start).toBe(START);
    expect(shots[2].end).toBe(at("22:30:00"));
  });
  it("starts a phase at the first shot the controller fired in it, not at its later post", () => {
    const zone1 = [row("P3", START), row("P0", at("22:02:18.694")), row("P1", at("22:07:56.719"))];
    const bands = phaseBands(zone1, START, at("22:30:00"));
    const valve = [
      row("off", START),
      row("on", at("22:03:22.638")),
      row("off", at("22:04:47.630")),
    ];
    const shots = valveShots(valve, decisions, 1, START, at("22:30:00"));
    expect(alignBands(bands, shots)).toEqual([
      { phase: "P3", start: START, end: at("22:02:18.694") },
      { phase: "P0", start: at("22:02:18.694"), end: at("22:03:22.638") },
      { phase: "P1", start: at("22:03:22.638"), end: at("22:30:00") },
    ]);
    expect(bands[1].end).toBe(at("22:07:56.719"));
    // A shot fired in the phase it sits in (zone 2's P3 emergency) or never named moves nothing.
    const emergency = valveShots(
      [row("on", START), row("off", at("22:01:16.000"))],
      decisions,
      2,
      START,
      at("22:30:00"),
    );
    expect(alignBands(bands, emergency)).toEqual(bands);
    const unnamed = { ...shots[0], phase: null, reason: null };
    expect(alignBands(bands, [unnamed])).toEqual(bands);
  });
  it("never lends a hand-opened valve another zone's or a later decision", () => {
    // Zone 3 opened by hand: the next post fired only zone 2.
    const row3 = [row("off", START), row("on", at("22:10:00")), row("off", at("22:11:00"))];
    expect(valveShots(row3, decisions, 3, START, at("22:30:00"))).toEqual([
      { start: at("22:10:00"), end: at("22:11:00"), open: false, phase: null, reason: null },
    ]);
  });
});

describe("blocks and holds", () => {
  // Flower 2 on 22 September 2026: a dosing hold during the ramp, then two zones blocked at their
  // daily budget until lights-off, and the kill switch off across a restart.
  const day = [
    decision(at("22:00:00", "2026-09-21")),
    decision(at("00:06:00.712"), [], ["Z2 P1 external hold (nutrient_dosing_active)"]),
    decision(
      at("00:25:18.897"),
      [],
      [
        "Z1 P1 external hold (nutrient_dosing_active)",
        "Z2 P1 external hold (nutrient_dosing_active)",
        "Z3 P1 external hold (nutrient_dosing_active)",
      ],
    ),
    decision(
      at("00:28:23.030"),
      [],
      [
        "Z2 P1 external hold (nutrient_dosing_active)",
        "Z3 P1 external hold (nutrient_dosing_active)",
      ],
    ),
    decision(at("00:45:03.238"), ["Z2 P1 P1 flush/runoff EC 4.9 (at ceiling 27)"]),
    decision(
      at("01:31:47.000"),
      [],
      ["Z2 P1 BLOCK daily-cap 106/80L (budget; emergencies exempt)"],
    ),
    decision(
      at("02:06:57.000"),
      ["Z1 P2 P2 top-up VWC 33<33"],
      ["Z2 P1 BLOCK daily-cap 106/80L (budget; emergencies exempt)"],
    ),
    decision(
      at("03:02:40.000"),
      [],
      [
        "Z1 P2 BLOCK daily-cap 84/80L (budget; emergencies exempt)",
        "Z2 P1 BLOCK daily-cap 106/80L (budget; emergencies exempt)",
      ],
    ),
    decision(at("10:00:14.000")),
    decision(
      at("21:09:37.000"),
      [],
      ["Z1 P3 room off (kill switch)", "Z2 P3 room off (kill switch)"],
    ),
    decision(at("21:10:37.000")),
  ];
  const from = at("22:00:00", "2026-09-21");
  it("collapses repeats into one interval per unbroken hold", () => {
    expect(zoneBlocks(day, 2, from, START)).toEqual([
      {
        kind: "hold",
        text: "external hold (nutrient_dosing_active)",
        start: at("00:06:00.712"),
        end: at("00:45:03.238"),
        open: false,
      },
      {
        kind: "cap",
        text: "BLOCK daily-cap 106/80L (budget; emergencies exempt)",
        start: at("01:31:47.000"),
        end: at("10:00:14.000"),
        open: false,
      },
      {
        kind: "hold",
        text: "room off (kill switch)",
        start: at("21:09:37.000"),
        end: at("21:10:37.000"),
        open: false,
      },
    ]);
    expect(
      zoneBlocks(day, 1, from, START).map(({ kind, start, end }) => [kind, start, end]),
    ).toEqual([
      ["hold", at("00:25:18.897"), at("00:28:23.030")],
      ["cap", at("03:02:40.000"), at("10:00:14.000")],
      ["hold", at("21:09:37.000"), at("21:10:37.000")],
    ]);
    expect(zoneBlocks(day, 4, from, START)).toEqual([]);
  });
  it("keeps one interval while only the numbers move, and one still held open at the end", () => {
    const rows = [
      decision(at("12:00:00"), [], ["Z1 P2 BLOCK daily-cap 80/80L (budget; emergencies exempt)"]),
      decision(at("12:30:00"), [], ["Z1 P2 BLOCK daily-cap 81.5/80L (budget; emergencies exempt)"]),
      decision(
        at("13:00:00"),
        [],
        [
          "Z1 P2 BLOCK high EC 9.1 — feed not dilutive (self-clears)",
          "Z2 P2 external hold (tank_fill)",
        ],
      ),
    ];
    expect(zoneBlocks(rows, 1, at("11:00:00"), at("14:00:00"))).toEqual([
      {
        kind: "cap",
        text: "BLOCK daily-cap 80/80L (budget; emergencies exempt)",
        start: at("12:00:00"),
        end: at("13:00:00"),
        open: false,
      },
      {
        kind: "block",
        text: "BLOCK high EC 9.1 — feed not dilutive (self-clears)",
        start: at("13:00:00"),
        end: at("14:00:00"),
        open: true,
      },
    ]);
    expect(zoneBlocks(rows, 2, at("11:00:00"), at("14:00:00"))[0]).toMatchObject({
      kind: "hold",
      open: true,
    });
    // Without the attribute lists nothing is guessed from the state text.
    expect(
      zoneBlocks([row("Z1 P2 BLOCK daily-cap 80/80L", at("12:00:00"))], 1, 0, at("14:00:00")),
    ).toEqual([]);
  });
});

describe("setpoint changes", () => {
  it("lists each change inside the day, not a restart's unavailable reading", () => {
    const rows = {
      "number.a": [
        row("33.7", START),
        row("unavailable", at("23:09:00")),
        row("33.7", at("23:10:00")),
        row("30.2", at("23:30:00")),
      ],
      "number.b": [row("3", START), row("2.5", at("23:00:00"))],
      // The value carried in at lights-on is where the day starts, not a change today.
      "number.c": [row("6", START)],
    };
    expect(
      setpointChanges(rows, ["number.a", "number.b", "number.c"], START, at("23:59:00")),
    ).toEqual([
      { entityId: "number.b", time: at("23:00:00"), from: 3, to: 2.5 },
      { entityId: "number.a", time: at("23:30:00"), from: 33.7, to: 30.2 },
    ]);
  });
  it("reads numbers as steps and readings, skipping what is not a number", () => {
    const rows = [row("30.2", START), row("", at("22:10:00")), row("31", at("22:20:00"))];
    expect(readings(rows, START, at("23:00:00"))).toEqual([
      { time: START, value: 30.2 },
      { time: at("22:20:00"), value: 31 },
    ]);
    expect(levels(rows, START, at("23:00:00"))).toEqual([
      { value: 30.2, start: START, end: at("22:10:00") },
      { value: 31, start: at("22:20:00"), end: at("23:00:00") },
    ]);
  });
});

describe("where the VWC line breaks", () => {
  const minutes = (count: number) => START + count * 60_000;
  it("a reading that holds still is not a gap: Home Assistant records only a change", () => {
    // Overnight a probe can read 41.2 % for 50 minutes; nothing is recorded until it moves.
    const rows = [row("41.3", START), row("41.2", minutes(10)), row("41.1", minutes(60))];
    expect(recordedGaps(rows, START, minutes(120))).toEqual([]);
  });
  it("breaks from each unreadable state to the next number, and at the window's end", () => {
    const rows = [
      row("41.3", START),
      row("unavailable", minutes(30)),
      row("unknown", minutes(35)),
      row("41.0", minutes(50)),
      row("unavailable", minutes(90)),
    ];
    expect(recordedGaps(rows, START, minutes(120))).toEqual([
      { start: minutes(30), end: minutes(50) },
      { start: minutes(90), end: minutes(120) },
    ]);
  });
  it("breaks at a silence over two hours, which can be Home Assistant not running", () => {
    const rows = [row("41.3", START), row("40.1", minutes(121)), row("40.0", minutes(240))];
    expect(recordedGaps(rows, START, minutes(300))).toEqual([{ start: START, end: minutes(121) }]);
  });
  it("cuts a gap to the window, and reads the state carried into it", () => {
    const rows = [row("unavailable", START - 60_000), row("41.3", minutes(20))];
    expect(recordedGaps(rows, START, minutes(60))).toEqual([{ start: START, end: minutes(20) }]);
    expect(
      recordedGaps([row("41.3", START), row("unknown", minutes(90))], START, minutes(60)),
    ).toEqual([]);
  });
  it("draws through a quiet stretch, and holds the last reading up to a gap", () => {
    const x = (time: number) => (time - START) / 60_000,
      y = (value: number) => value;
    const points = [
      { time: START, value: 41 },
      { time: minutes(50), value: 40 },
      { time: minutes(70), value: 39 },
      { time: minutes(100), value: 38 },
    ];
    expect(readingsPath(points, x, y)).toBe("M0.0 41.0L50.0 40.0L70.0 39.0L100.0 38.0");
    // Unreadable from 60 to 70 minutes: 40 holds until 60, and the line starts again at 70.
    expect(readingsPath(points, x, y, [{ start: minutes(60), end: minutes(70) }])).toBe(
      "M0.0 41.0L50.0 40.0L60.0 40.0M70.0 39.0L100.0 38.0",
    );
    // A silence from the reading itself has nothing to hold.
    expect(readingsPath(points, x, y, [{ start: minutes(70), end: minutes(100) }])).toBe(
      "M0.0 41.0L50.0 40.0L70.0 39.0M100.0 38.0",
    );
  });
});

describe("who changed a setting", () => {
  const trigger = "number.crop_steering_zone_1_p2_vwc_threshold";
  const shots = "number.crop_steering_zone_1_p1_maximum_shots";
  const change = { entityId: trigger, time: at("07:04:12"), from: 71.3, to: 63.3 };
  const entry = (fields: Partial<ReturnType<typeof logbookEntries>[number]> = {}) => ({
    entityId: trigger,
    time: at("07:04:12") + 300,
    state: "63.3",
    userId: null,
    eventType: null,
    source: null,
    ...fields,
  });
  it("reads Home Assistant's logbook over REST and over its websocket", () => {
    expect(
      logbookEntries([
        {
          when: "2026-09-22T07:04:12.300000+00:00",
          entity_id: trigger,
          state: "63.3",
          context_user_id: "u1",
        },
        {
          when: at("07:05:00") / 1000,
          entity_id: shots,
          state: "10",
          context_event_type: "automation_triggered",
          context_name: "Morning tweak",
        },
        { when: "2026-09-22T07:06:00Z", name: "An entry with no state", message: "started" },
      ]),
    ).toEqual([
      entry({ userId: "u1" }),
      {
        entityId: shots,
        time: at("07:05:00"),
        state: "10",
        userId: null,
        eventType: "automation_triggered",
        source: "Morning tweak",
      },
    ]);
    expect(logbookEntries({ message: "not a list" })).toEqual([]);
  });
  it("names a user by their person, or the signed-in user's own name", () => {
    const person = (user_id: unknown, friendly_name?: string) =>
      ({ entity_id: "", state: "home", attributes: { user_id, friendly_name } }) as EntityState;
    const people = peopleByUser(
      {
        "person.sam": person("u1", "Sam"),
        "person.guest": person(null, "Guest"),
        "person.robin": person("u2"),
      },
      { id: "u3", name: "Admin" },
    );
    expect([...people]).toEqual([
      ["u1", "Sam"],
      ["u2", "robin"],
      ["u3", "Admin"],
    ]);
    // A person's name wins over the account's.
    expect(peopleByUser({ "person.sam": person("u1", "Sam") }, { id: "u1", name: "sam2" })).toEqual(
      new Map([["u1", "Sam"]]),
    );
  });
  it("says who: an automation or script by name, a person, or Auto setpoints", () => {
    const people = new Map([["u1", "Sam"]]);
    const who = (fields: Parameters<typeof entry>[0], setting = change) =>
      changedBy(setting, [entry({ entityId: setting.entityId, ...fields })], people);
    expect(who({ userId: "u1" })).toBe("Sam");
    expect(who({ eventType: "automation_triggered", source: "Morning tweak", userId: "u1" })).toBe(
      "Automation “Morning tweak”",
    );
    expect(who({ eventType: "script_started", source: "Flush" })).toBe("Script “Flush”");
    expect(who({ eventType: "automation_triggered" })).toBe("An automation");
    // The controller writes as Home Assistant's Supervisor, nobody's person, and only three of a
    // zone's moisture levels: never its rescue level.
    expect(who({ userId: "supervisor" })).toBe("Auto setpoints");
    const rescue = {
      ...change,
      entityId: "number.crop_steering_zone_1_p3_emergency_vwc_threshold",
    };
    expect(who({ userId: "supervisor" }, rescue)).toBe(null);
    const room = { ...change, entityId: "number.crop_steering_f1_p2_vwc_threshold" };
    expect(who({ userId: "supervisor" }, room)).toBe(null);
    const other = { ...change, entityId: shots, to: 10 };
    expect(who({ userId: "supervisor", state: "10" }, other)).toBe(null);
    expect(who({})).toBe(null);
  });
  it("matches the entry of that change only", () => {
    const people = new Map([["u1", "Sam"]]);
    // Another setting, another value, or a minute away is another change.
    for (const fields of [{ entityId: shots }, { state: "60" }, { time: at("07:05:12") }])
      expect(changedBy(change, [entry({ userId: "u1", ...fields })], people)).toBe(null);
    // The nearest of two.
    expect(
      changedBy(
        change,
        [entry({ userId: "u2", time: at("07:04:13") + 900 }), entry({ userId: "u1" })],
        new Map([
          ["u1", "Sam"],
          ["u2", "Robin"],
        ]),
      ),
    ).toBe("Sam");
  });
  it("says it in one sentence: who, which way, the new value and the one it replaced", () => {
    expect(changeSentence("Maximum P1 shots", "", 6, 10, "Sam")).toBe(
      "Sam raised Maximum P1 shots to 10 (was 6)",
    );
    expect(changeSentence("Maintenance trigger", "%", 71.3, 63.3, "Auto setpoints")).toBe(
      "Auto setpoints lowered Maintenance trigger to 63.3% (was 71.3%)",
    );
    expect(changeSentence("Maximum EC", "mS/cm", 8.5, 9, null)).toBe(
      "Maximum EC raised to 9 mS/cm (was 8.5 mS/cm)",
    );
    expect(changeSentence("Time between P1 shots", "min", 15, 12.345, null)).toBe(
      "Time between P1 shots lowered to 12.35 min (was 15 min)",
    );
  });
  it("names who made the demo day's changes", () => {
    const now = at("16:00:00"),
      states = createDemo(now);
    const day = growDay(10, 22, now)!;
    const ids = [
      "number.crop_steering_zone_1_p1_target_vwc",
      "number.crop_steering_zone_2_maximum_ec",
    ];
    const rows = demoDay(
      states,
      { entityIds: ids, attributeIds: [], start: day.start, end: now },
      now,
    );
    const entries = demoLogbook(states, { entityIds: ids, start: day.start, end: now }, now);
    const people = peopleByUser(states);
    expect(
      setpointChanges(rows, ids, day.start, now).map((item) => [
        item.entityId.slice("number.crop_steering_".length),
        changedBy(item, entries, people),
      ]),
    ).toEqual([
      ["zone_1_p1_target_vwc", "Auto setpoints"],
      ["zone_2_maximum_ec", "Alex"],
    ]);
  });
});

const drying = (from: number, minutes: number, start: number, rate: number): Reading[] =>
  Array.from({ length: minutes + 1 }, (_, minute) => ({
    time: from + minute * 60_000,
    // A probe's noise, alternating around the trend.
    value: start - (rate * minute) / 60 + (minute % 2 ? 0.04 : -0.04),
  }));

describe("dry-down", () => {
  const T = at("02:00:00");
  it("fits the recent fall and says when it reaches the threshold", () => {
    const points = drying(T, 40, 32, 0.8);
    const fit = dryDown(points, 30, T, T + 40 * 60_000)!;
    expect(fit.rate).toBeCloseTo(0.8, 1);
    // 32 - 0.8 * 40/60 = 31.47 now; 1.47 points at 0.8 per hour is about 110 minutes more.
    expect(fit.from.value).toBeCloseTo(31.47, 1);
    expect(Math.abs(fit.at - (T + 150 * 60_000))).toBeLessThan(4 * 60_000);
  });
  it("says nothing without enough recent data or a real fall", () => {
    const now = T + 40 * 60_000;
    expect(dryDown(drying(T, 40, 32, -0.5), 30, T, now)).toBeNull();
    expect(dryDown(drying(T, 40, 32, 0), 30, T, now)).toBeNull();
    expect(dryDown(drying(T, 10, 32, 0.8), 30, T, now)).toBeNull();
    expect(
      dryDown(
        drying(T, 40, 32, 0.8).filter((_, i) => i % 12 === 0),
        30,
        T,
        now,
      ),
    ).toBeNull();
    // Readings before `since` (the shot still wetting up) are not used.
    expect(dryDown(drying(T, 40, 32, 0.8), 30, T + 30 * 60_000, now)).toBeNull();
  });
});

describe("next shot", () => {
  const day: GrowDay = {
    start: START,
    lightsOff: at("10:00:00", "2026-09-23"),
    end: at("22:00:00", "2026-09-23"),
  };
  const now = at("03:00:00", "2026-09-23");
  const shot = (end: number, open = false): Shot => ({
    start: end - 120_000,
    end,
    open,
    phase: "P2",
    reason: null,
  });
  const zone = {
    phase: "P2" as string | null,
    since: at("01:00:00", "2026-09-23"),
    held: null as Block | null,
    lastShot: shot(at("01:50:00", "2026-09-23")) as Shot | null,
    points: drying(at("02:00:00", "2026-09-23"), 60, 32, 0.8),
    vwc: 31.2 as number | null,
    threshold: 30 as number | null,
    ceiling: null as number | null,
    interval: 20 as number | null,
    maxWait: 60 as number | null,
  };
  it("estimates P2 from the dry-down since the last shot settled", () => {
    const next = nextShot(zone, day, now);
    expect(next.basis).toBe("dry-down");
    expect(next.fit!.rate).toBeCloseTo(0.8, 1);
    expect(Math.abs(next.at! - at("04:30:00", "2026-09-23"))).toBeLessThan(5 * 60_000);
    // Past lights-off it is no estimate, though the line is still drawn.
    const early = { ...day, lightsOff: at("04:00:00", "2026-09-23") };
    expect(nextShot(zone, early, now)).toMatchObject({ at: null, basis: "late" });
    expect(nextShot(zone, early, now).fit).toBeDefined();
  });
  it("is due at or under the threshold, settling right after a shot, and silent when flat", () => {
    expect(nextShot({ ...zone, vwc: 29.9 }, day, now)).toEqual({ at: now, basis: "due" });
    expect(nextShot({ ...zone, lastShot: shot(now - 20 * 60_000) }, day, now).basis).toBe(
      "settling",
    );
    const flat = drying(at("02:00:00", "2026-09-23"), 60, 32, 0);
    expect(nextShot({ ...zone, points: flat }, day, now).basis).toBe("no-dry-down");
    expect(nextShot({ ...zone, vwc: null }, day, now).basis).toBe("no-reading");
  });
  it("follows the engine's own timing in P0 and P1", () => {
    const p0 = { ...zone, phase: "P0", since: at("02:30:00", "2026-09-23") };
    expect(nextShot(p0, day, now)).toEqual({ at: at("03:30:00", "2026-09-23"), basis: "p0-wait" });
    expect(nextShot({ ...p0, since: at("01:00:00", "2026-09-23") }, day, now).at).toBe(now);
    const p1 = { ...zone, phase: "P1", ceiling: 36, lastShot: shot(at("02:50:00", "2026-09-23")) };
    expect(nextShot(p1, day, now)).toEqual({
      at: at("03:10:00", "2026-09-23"),
      basis: "p1-interval",
    });
    expect(nextShot({ ...p1, vwc: 36.5 }, day, now).basis).toBe("ramp-done");
  });
  it("estimates nothing while a shot runs, a hold is open, or after lights-off", () => {
    expect(nextShot({ ...zone, lastShot: shot(now, true) }, day, now).basis).toBe("firing");
    const held: Block = { kind: "cap", text: "BLOCK daily-cap", start: 0, end: now, open: true };
    expect(nextShot({ ...zone, held }, day, now).basis).toBe("held");
    expect(nextShot({ ...zone, phase: "P3" }, day, now).basis).toBe("night");
    expect(nextShot(zone, day, at("10:30:00", "2026-09-23")).basis).toBe("night");
  });
});

describe("live updates extend a loaded day", () => {
  const state = (
    entity_id: string,
    value: string,
    changed: number,
    updated = changed,
    attributes: Record<string, unknown> = {},
  ): EntityState => ({
    entity_id,
    state: value,
    attributes,
    last_changed: new Date(changed).toISOString(),
    last_updated: new Date(updated).toISOString(),
  });
  const request = {
    entityIds: ["switch.valve", "sensor.vwc", "sensor.new"],
    attributeIds: ["sensor.decision"],
  };
  const loaded = {
    "switch.valve": [row("off", START)],
    "sensor.vwc": [row("30.1", START)],
    "sensor.decision": [decision(START)],
  };
  it("appends what changed, when it changed", () => {
    const states = {
      "switch.valve": state("switch.valve", "on", at("22:05:00"), at("22:05:30")),
      "sensor.vwc": state("sensor.vwc", "30.1", at("22:06:00")),
      "sensor.decision": state(
        "sensor.decision",
        "Holding — all zones in band",
        START,
        at("22:07:00"),
        { fired: [], blocked: ["Z1 P2 zone disabled"] },
      ),
      "sensor.new": state("sensor.new", "P0", at("22:08:00")),
      "sensor.unrelated": state("sensor.unrelated", "1", at("22:08:00")),
    };
    const rows = appendLive(loaded, states, request);
    expect(rows["switch.valve"]).toEqual([row("off", START), row("on", at("22:05:00"))]);
    // The same reading again is not a new row.
    expect(rows["sensor.vwc"]).toBe(loaded["sensor.vwc"]);
    // The decision's blocked list changed without its state: that is a row, at last_updated.
    expect(rows["sensor.decision"].at(-1)).toEqual(
      row("Holding — all zones in band", at("22:07:00"), {
        fired: [],
        blocked: ["Z1 P2 zone disabled"],
      }),
    );
    expect(rows["sensor.new"]).toEqual([row("P0", at("22:08:00"))]);
    expect(rows["sensor.unrelated"]).toBeUndefined();
    // Pure, and the same object when there is nothing new.
    expect(loaded["switch.valve"]).toEqual([row("off", START)]);
    expect(appendLive(rows, states, request)).toBe(rows);
  });
  it("never rewrites the past with an older state", () => {
    const rows = { "switch.valve": [row("off", START), row("on", at("22:05:00"))] };
    const stale = { "switch.valve": state("switch.valve", "off", at("21:00:00")) };
    expect(appendLive(rows, stale, request)).toBe(rows);
  });
});

describe("what a room's timeline reads", () => {
  it("each zone's phase, valve and probe, the setpoints, and the decision with attributes", () => {
    const states = createDemo(Date.UTC(2026, 8, 23, 3));
    const room = buildRoom(
      states,
      discoverRooms(states).find((item) => item.prefix === "")!,
    );
    const read = timelineEntities(room, states);
    expect(read.zones[0]).toEqual({
      id: 1,
      phase: "sensor.crop_steering_zone_1_phase",
      valve: "switch.demo_valve_1",
      vwc: "sensor.crop_steering_vwc_zone_1",
    });
    for (const id of [
      "sensor.crop_steering_zone_3_phase",
      "switch.demo_valve_2",
      "number.crop_steering_zone_1_p2_vwc_threshold",
      "number.crop_steering_lights_on_hour",
    ])
      expect(read.entityIds).toContain(id);
    expect(read.entityIds.some((id) => id.startsWith("number.crop_steering_f1_"))).toBe(false);
    expect(read.attributeIds).toEqual(["sensor.crop_steering_current_decision"]);
  });
});

describe("the demo's day", () => {
  // Seven hours after Flower 2's demo lights-on, in whatever time zone the test runs.
  const now = new Date(2026, 8, 23, 17, 0).getTime();
  const states = createDemo(now);
  const load = (prefix: string) => {
    const room = buildRoom(
      states,
      discoverRooms(states).find((item) => item.prefix === prefix)!,
    );
    const read = timelineEntities(room, states);
    const hour = (key: string) =>
      Number(states[`number.crop_steering_${prefix}lights_${key}_hour`].state);
    const day = growDay(hour("on"), hour("off"), now)!;
    const rows = demoDay(states, { ...read, start: day.start, end: now }, now);
    const decisions = rows[read.attributeIds[0]];
    return { read, day, rows, decisions };
  };
  it("is a whole plausible day that ends now, recorded only for what was asked", () => {
    const { read, day, rows, decisions } = load("");
    expect(Object.keys(rows).sort()).toEqual([...read.entityIds, ...read.attributeIds].sort());
    expect(
      Object.values(rows)
        .flat()
        .every((item) => item.time >= day.start && item.time <= now),
    ).toBe(true);
    for (const zone of read.zones) {
      const phases = phaseBands(rows[zone.phase], day.start, now).map((band) => band.phase);
      expect(phases).toEqual(["P3", "P0", "P1", "P2"]);
      const shots = valveShots(rows[zone.valve!], decisions, zone.id, day.start, now);
      // The controller named every shot it fired: six ramp shots, then top-ups.
      expect(shots.every((shot) => shot.phase !== null)).toBe(true);
      expect(shots.filter((shot) => shot.phase === "P1")).toHaveLength(6);
      expect(shots.some((shot) => shot.phase === "P2")).toBe(true);
      // The probe's history ends at its live reading.
      expect(rows[zone.vwc!].at(-1)!.state).toBe(states[zone.vwc!].state);
    }
  });
  it("shows a hold, the change that ended it, and a supervisor's setpoint move", () => {
    const { day, rows, decisions } = load("");
    const [hold] = zoneBlocks(decisions, 2, day.start, now);
    expect(hold).toMatchObject({ kind: "block", open: false });
    expect(hold.text).toMatch(/^BLOCK high EC/);
    const changes = setpointChanges(
      rows,
      ["number.crop_steering_zone_2_maximum_ec", "number.crop_steering_zone_1_p1_target_vwc"],
      day.start,
      now,
    );
    expect(changes.map(({ entityId, from, to }) => [entityId, from, to])).toEqual([
      ["number.crop_steering_zone_1_p1_target_vwc", 66, 64],
      ["number.crop_steering_zone_2_maximum_ec", 8.5, 9],
    ]);
    expect(Math.abs(changes[1].time - hold.end)).toBeLessThan(60_000);
    // Flower 1's zone 3, disabled for inspection, is held from then on.
    const f1 = load("f1_");
    expect(zoneBlocks(f1.decisions, 3, f1.day.start, now)).toEqual([
      expect.objectContaining({ kind: "hold", text: "zone disabled", open: true }),
    ]);
  });
});

describe("earlier grow-days on today's axis", () => {
  // NZ daylight saving starts 02:00 on 27 September 2026: the grow-day from 10:00 NZST on the 26th
  // to 10:00 NZDT on the 27th is 23 hours long.
  let zone: string | undefined;
  beforeAll(() => {
    zone = process.env.TZ;
    process.env.TZ = "Pacific/Auckland";
  });
  afterAll(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });
  const z = (iso: string) => Date.parse(iso);
  const tenToTen = () => ({ on: 10, off: 22 });
  it("a clock change makes a 23-hour grow-day, placed by hours since its own lights-on", () => {
    const day = growDay(10, 22, z("2026-09-27T01:00:00Z"))!; // 14:00 NZDT on the 27th
    const [yesterday, before] = earlierDays(day, 2, tenToTen);
    expect(yesterday).toEqual({
      start: z("2026-09-25T22:00:00Z"), // 10:00 NZST
      lightsOff: z("2026-09-26T10:00:00Z"), // 22:00 NZST
      end: z("2026-09-26T21:00:00Z"), // 10:00 NZDT
    });
    expect((yesterday.end - yesterday.start) / 3_600_000).toBe(23);
    expect(before.end - before.start).toBe(24 * 3_600_000);
    // A reading at 09:50 NZDT is 22 h 50 min after that day's lights-on, not 23 h 50 min.
    const rows = {
      vwc: [0, 5, 10, 22.8333].map((hour, index) =>
        row(String(30 - index), yesterday.start + hour * 3_600_000),
      ),
    };
    const trace = dayTrace(rows, { vwc: "vwc", valve: null, active: null }, 1, yesterday)!;
    expect(trace.points.at(-1)!.hour).toBeCloseTo(22.8333, 3);
    expect(atHour(trace.points, 22.8333)).toBe(27);
  });
  it("a changed schedule moves the day's lights-on, and its lights-off with it", () => {
    const day = growDay(10, 22, z("2026-09-23T03:00:00Z"))!; // 15:00 NZST on the 23rd
    const change = (at: string) => (time: number) =>
      time < z(at) ? { on: 8, off: 20 } : { on: 10, off: 22 };
    // Changed in the evening: the 22nd came on at 08:00 and ran 26 hours to today's 10:00.
    const [evening] = earlierDays(day, 1, change("2026-09-22T09:00:00Z"));
    expect(evening).toEqual({
      start: z("2026-09-21T20:00:00Z"), // 08:00 on the 22nd
      lightsOff: z("2026-09-22T08:00:00Z"), // 20:00
      end: day.start,
    });
    // Changed before 08:00 on the 22nd: that day came on at 10:00, the one before ran 26 hours.
    const [early, earlier] = earlierDays(day, 2, change("2026-09-21T19:00:00Z"));
    expect(early.start).toBe(z("2026-09-21T22:00:00Z"));
    expect(earlier.start).toBe(z("2026-09-20T20:00:00Z"));
    expect((earlier.end - earlier.start) / 3_600_000).toBe(26);
  });
  it("reads the lights hours, the room switch and the setup revision from the recorded week", () => {
    const states = createDemo(z("2026-09-23T03:00:00Z"));
    const room = buildRoom(
      states,
      discoverRooms(states).find((item) => item.prefix === "")!,
    );
    const read = earlierEntities(room, states);
    for (const id of [
      "sensor.crop_steering_vwc_zone_1",
      "switch.demo_valve_3",
      "number.crop_steering_lights_on_hour",
      "switch.crop_steering_room_active",
    ])
      expect(read.entityIds).toContain(id);
    expect(read.entityIds.some((id) => /phase|threshold|decision/.test(id))).toBe(false);
    expect(read.attributeIds).toEqual(["sensor.crop_steering_engine_config"]);
    const day = growDay(10, 22, z("2026-09-23T03:00:00Z"))!;
    const days = earlierDays(day, 7, tenToTen);
    const config = read.attributeIds[0];
    const vwc = days.flatMap((past) =>
      [0, 6, 12].map((hour) => row("30", past.start + hour * 3_600_000)),
    );
    const week = {
      "sensor.crop_steering_vwc_zone_1": vwc,
      // Moved to 08:00 on the 20th: its grow-day came on then.
      "number.crop_steering_lights_on_hour": [
        row("10", days[6].start),
        row("8", z("2026-09-19T21:00:00Z")),
      ],
      "switch.crop_steering_room_active": [
        row("on", days[6].start),
        row("off", days[1].start + 3_600_000),
        row("on", days[1].start + 7_200_000),
      ],
      [config]: [
        row("ready", days[6].start, { setup_revision: 4 }),
        row("ready", days[3].start + 3_600_000),
        row("ready", days[2].start + 3_600_000, { setup_revision: 5 }),
      ],
    };
    const cut = earlierTraces(week, room, day, { on: 10, off: 22 }, config);
    const zone1 = cut.traces.get(1)!;
    // The day before yesterday the room was switched off for an hour: nothing to compare.
    expect(zone1.map((trace) => trace !== null)).toEqual([
      true,
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(cut.setup).toEqual([5, 5, 4, 4, 4, 4, 4]);
    expect(revisionAt(week[config], days[3].start + 3_600_000 + 1)).toBe(4);
    expect(revisionAt(week[config], days[6].start - 1)).toBeNull();
    expect(cut.traces.get(2)!.every((trace) => trace === null)).toBe(true); // nothing recorded
  });
});

describe("how today is tracking", () => {
  const START = at("22:00:00");
  const hours = (list: [number, number][]) =>
    list.map(([hour, value]) => ({ hour, value, time: START + hour * 3_600_000 }));
  const day: GrowDay = {
    start: START,
    lightsOff: START + 12 * 3_600_000,
    end: START + 24 * 3_600_000,
  };
  const shot = (from: number, seconds: number): Shot => ({
    start: START + from * 3_600_000,
    end: START + from * 3_600_000 + seconds * 1000,
    open: false,
    phase: null,
    reason: null,
  });
  // Yesterday: a P1 ramp from 25 % that reached the 28.4 % target at 1.5 h, then P2.
  const yesterday: DayTrace = {
    day,
    points: hours([
      [0, 26],
      [0.5, 25],
      [1, 27],
      [1.5, 28.6],
      [3, 27.6],
      [3.3, 27],
      [3.5, 26.6],
    ]),
    gaps: [],
    shots: [shot(0.6, 120), shot(1, 150), shot(3.4, 90)],
  };
  it("VWC now, the P1 target and water so far against yesterday at the same hour", () => {
    const now = compareDays([yesterday], 3.25, 28.1, 28.4)!;
    expect(now.vwc).toBeCloseTo(28.1 - 27.1, 6); // yesterday read 27.1 % a quarter past three hours in
    expect(now.reached).toBe(1.5);
    expect(now.reachedBy).toBe(1);
    expect(now.seconds).toBe(270); // the two shots before 3.25 h, not the one at 3.4 h
    expect(openSeconds(yesterday.shots, START, 3.41)).toBeCloseTo(270 + 36, 6); // 36 s of the third
    // A quiet hour and a half between two readings reads between them: the reading held, then moved.
    expect(atHour(yesterday.points, 2.25)).toBeCloseTo(28.1, 6);
    // Where the probe could not be read, the reading before holds until then, and there is none
    // inside it; the reading after it holds from its end.
    const unreadable = [{ start: START + 2 * 3_600_000, end: START + 2.75 * 3_600_000 }];
    expect(atHour(yesterday.points, 1.75, unreadable)).toBe(28.6);
    expect(atHour(yesterday.points, 2.25, unreadable)).toBeNull();
    expect(atHour(yesterday.points, 2.9, unreadable)).toBe(27.6);
    // Before the first reading and after the last: the nearest within ten minutes.
    expect(atHour(yesterday.points, 3.6)).toBe(26.6);
    expect(atHour(yesterday.points, 3.75)).toBeNull();
    // Today reached 28.4 % ten minutes later than yesterday.
    expect(
      reachedHour(
        hours([
          [0, 25],
          [1.5, 28],
          [1.6667, 28.5],
        ]),
        28.4,
      ),
    ).toBeCloseTo(1.6667, 4);
  });
  it("a P1 target yesterday never reached, and a day that started above it", () => {
    const short = {
      ...yesterday,
      points: hours([
        [0, 26],
        [2, 28],
        [4, 27],
      ]),
    };
    expect(compareDays([short], 3, 28, 28.4)).toMatchObject({ reached: null, reachedBy: 0 });
    expect(
      reachedHour(
        hours([
          [0, 29],
          [1, 30],
        ]),
        28.4,
      ),
    ).toBe(0);
    expect(reachedHour([], 28.4)).toBeNull();
  });
  it("a typical day reaches the P1 target only when its median day did", () => {
    const at = (hour: number | null): DayTrace => ({
      ...yesterday,
      points: hours(
        hour === null
          ? [
              [0, 26],
              [3, 27],
            ]
          : [
              [0, 26],
              [hour, 29],
              [3, 27],
            ],
      ),
    });
    // One of three days reached 28.4 %: the typical day did not.
    expect(compareDays([at(1), at(null), at(null)], 3, 28, 28.4)).toMatchObject({
      reached: null,
      reachedBy: 1,
    });
    // Two of three did: the median day's time, the later of the two.
    expect(compareDays([at(1), at(2), at(null)], 3, 28, 28.4)).toMatchObject({
      reached: 2,
      reachedBy: 2,
    });
    expect(compareDays([at(1), at(2), at(1.5)], 3, 28, 28.4)!.reached).toBe(1.5);
  });
  it("no recorded day: nothing to compare, and no line", () => {
    expect(compareDays([], 3, 28, 28.4)).toBeNull();
    const empty = dayTrace(
      { vwc: [row("27", START)] },
      { vwc: "vwc", valve: null, active: null },
      1,
      day,
    );
    expect(empty).toBeNull();
    const off = dayTrace(
      { vwc: [row("27", START), row("26", START + 3_600_000)], active: [row("off", START - 1)] },
      { vwc: "vwc", valve: null, active: "active" },
      1,
      day,
    );
    expect(off).toBeNull();
  });
  it("an earlier day keeps where its probe could not be read", () => {
    const hour = (count: number) => START + count * 3_600_000;
    const trace = dayTrace(
      { vwc: [row("27", hour(0)), row("unavailable", hour(1)), row("26", hour(2))] },
      { vwc: "vwc", valve: null, active: null },
      1,
      day,
    )!;
    expect(trace.gaps).toEqual([{ start: hour(1), end: hour(2) }]);
    expect(atHour(trace.points, 0.5, trace.gaps)).toBe(27);
    expect(atHour(trace.points, 1.5, trace.gaps)).toBeNull();
    expect(compareDays([trace], 1.5, 27, null)!.vwc).toBeNull();
  });
  it("an earlier day's line starts at lights-on on the reading carried in, as today's does", () => {
    const hour = (count: number) => START + count * 3_600_000;
    const trace = dayTrace(
      { vwc: [row("27.4", hour(-3)), row("27.1", hour(0.5)), row("26.8", hour(1))] },
      { vwc: "vwc", valve: null, active: null },
      1,
      day,
    )!;
    expect(trace.points.map((point) => [point.hour, point.value])).toEqual([
      [0, 27.4],
      [0.5, 27.1],
      [1, 26.8],
    ]);
    // Carried in unreadable: the line starts at the first reading.
    const unreadable = dayTrace(
      { vwc: [row("unavailable", hour(-3)), row("27.1", hour(0.5)), row("26.8", hour(1))] },
      { vwc: "vwc", valve: null, active: null },
      1,
      day,
    )!;
    expect(unreadable.points[0].hour).toBe(0.5);
  });
  it("the typical day: the median and middle half of the days recorded, where three or more were", () => {
    const days = [0, 1, 2, 3, 4].map((offset) =>
      hours(Array.from({ length: 13 }, (_, index) => [index / 2, 25 + offset] as [number, number])),
    );
    days[3] = days[3].filter((point) => point.hour <= 3); // one day stopped recording at 3 h
    const typical = typicalDay(days.map((points) => ({ points, gaps: [] })));
    expect(typical[0]).toEqual({ hour: 0, low: 26, median: 27, high: 28 });
    expect(typical.find((point) => point.hour > 4)).toMatchObject({
      low: 25.75,
      median: 26.5,
      high: 27.5,
    });
    expect(typical.at(-1)!.hour).toBeCloseTo(6, 9);
    // Two days are not a typical one.
    expect(typicalDay(days.slice(0, 2).map((points) => ({ points, gaps: [] })))).toEqual([]);
  });
  it("marks P2's levels from Auto setpoints' planned stop as stopped, not as a trigger", () => {
    const hour = (h: number) => START + h * 3_600_000;
    const level = (phase: string, from: number, to: number, value: number) => ({
      phase,
      value,
      start: hour(from),
      end: hour(to),
    });
    // GR2, 1 Oct 2026, lights 07:00 (START) to 20:00: the band all day, then 80.1 -> 70.1 -> 62.2 at 17:00.
    const steps = [
      level("P2", 1.7, 10, 80.1),
      level("P2", 10, 10 + 1 / 60, 70.1),
      level("P2", 10 + 1 / 60, 13, 62.2),
      level("P3", 13, 24, 60.6),
    ];
    const day = { start: START, end: hour(24) };
    const lightsOn = new Date(START);
    const clockAt = (h: number) =>
      `${String((lightsOn.getHours() + h) % 24).padStart(2, "0")}:${String(lightsOn.getMinutes()).padStart(2, "0")}`;
    expect(stoppedTargets(steps, clockAt(10), day).map((step) => !!step.stopped)).toEqual([
      false,
      true,
      true,
      false,
    ]);
    // A step set within the minute before the stop still counts; two minutes before is the day's.
    const early = (seconds: number) => [{ ...steps[1], start: hour(10) - seconds * 1000 }];
    expect(stoppedTargets(early(30), clockAt(10), day)[0].stopped).toBe(true);
    expect(stoppedTargets(early(120), clockAt(10), day)[0].stopped).toBeUndefined();
    // No stop (a zone not on Auto setpoints) marks nothing.
    expect(stoppedTargets(steps, null, day).some((step) => step.stopped)).toBe(false);
    // A stop that comes later in the grow day, past midnight, marks nothing earlier.
    expect(stoppedTargets(steps, clockAt(23), day).some((step) => step.stopped)).toBe(false);
  });
  it("targets: P0's additional dryback under the peak, a setpoint changed mid-day, a plan's snapshot", () => {
    const threshold = "number.crop_steering_zone_2_p2_vwc_threshold";
    const rows = {
      [threshold]: [row("26.6", START - 3_600_000), row("27.2", START + 4 * 3_600_000)],
    };
    const parameters = {
      p0_dryback_drop_percent: 3,
      dryback_target: 10,
      p1_target_vwc: 28.4,
      p2_vwc_threshold: 27.2,
      p3_emergency_vwc_threshold: 20,
    };
    const bands: PhaseBand[] = [
      { phase: "P0", start: START, end: START + 3_600_000 },
      { phase: "P1", start: START + 3_600_000, end: START + 2 * 3_600_000 },
      { phase: "P2", start: START + 2 * 3_600_000, end: START + 12 * 3_600_000 },
      { phase: "P3", start: START + 12 * 3_600_000, end: day.end },
    ];
    const points = [
      row("25", START),
      row("26", START + 600_000),
      row("25.2", START + 1_800_000),
    ].map((item) => ({ time: item.time, value: Number(item.state) }));
    const manual = setpointSteps(
      rows,
      parameters,
      (key) => (key === "p2_vwc_threshold" ? threshold : null),
      false,
    );
    expect(
      phaseTargets(bands, manual, points).map(({ phase, value, start }) => [
        phase,
        value,
        (start - START) / 3_600_000,
      ]),
    ).toEqual([
      ["P0", 26 * 0.97, 0], // P0's own 3 % below the highest reading since P0 began
      ["P1", 28.4, 1],
      ["P2", 26.6, 2],
      ["P2", 27.2, 4], // changed at 4 h
      ["P3", 26 * 0.9, 12], // held at the dryback target: 10 % below the day's peak
    ]);
    // A plan armed: its snapshot's values, whatever the numbers recorded.
    const planned = setpointSteps(
      rows,
      { ...parameters, p2_vwc_threshold: 25 },
      () => threshold,
      true,
    );
    expect(phaseTargets(bands, planned, points).filter((step) => step.phase === "P2")).toEqual([
      { phase: "P2", value: 25, start: bands[2].start, end: bands[2].end },
    ]);
    // P0 ends on its own additional dryback: the overnight target does not move its line.
    const deeper = setpointSteps(rows, { ...parameters, dryback_target: 40 }, () => null, false);
    expect(phaseTargets(bands, deeper, points)[0]).toMatchObject({ phase: "P0", value: 26 * 0.97 });
    // Last night's P3, carried into the start of the day, was held from a peak not in view.
    const carried: PhaseBand[] = [{ phase: "P3", start: START - 600_000, end: START }, ...bands];
    expect(phaseTargets(carried, manual, points).filter((step) => step.phase === "P3")).toEqual([
      { phase: "P3", value: 26 * 0.9, start: bands[3].start, end: bands[3].end },
    ]);
    // In P0 now: the projected rest of P0 keeps the level from the peak since P0 began.
    const now = START + 1_800_000;
    const ongoing: PhaseBand[] = [
      { phase: "P0", start: START, end: now },
      { phase: "P0", start: now, end: START + 3_600_000 },
    ];
    expect(phaseTargets(ongoing, manual, points).map((step) => step.value)).toEqual([
      26 * 0.97,
      26 * 0.97,
    ]);
    // Without the setting P0 has no target (the day chart fills in the controller's 3% first).
    expect(
      phaseTargets(
        bands.slice(0, 1),
        setpointSteps({}, {}, () => null, false),
        points,
      ),
    ).toEqual([]);
  });
  it("how far P0 dried, as the engine measures it", () => {
    const points = [
      { time: START, value: 30 },
      { time: START + 600_000, value: 30.5 },
      { time: START + 1_800_000, value: 28.1 },
      { time: START + 5_000_000, value: 20 },
    ];
    expect(morningDryback(points, { start: START, end: START + 3_600_000 })).toBeCloseTo(
      ((30.5 - 28.1) / 30.5) * 100,
      6,
    );
    expect(morningDryback(points, { start: 0, end: 1 })).toBeNull();
  });
  it("overnight, how far the zone has dried since today's peak, as the P3 target reads", () => {
    // GR2 on 28 Sep: peaked at 86.5% after the ramp, 60.1% in the night. The line said "P0
    // dryback 1.4% of 30%", this morning's figure from the lights-on reading, beside "P3".
    const points = [
      { time: START - 600_000, value: 90 }, // before lights-on: yesterday's
      { time: START, value: 61 },
      { time: START + 3_600_000, value: 86.5 },
      { time: START + 43_200_000, value: 62 },
    ];
    const tonight = dayDryback(points, START, 60.1)!;
    expect(tonight.peak).toBe(86.5);
    expect(tonight.dryback).toBeCloseTo(((86.5 - 60.1) / 86.5) * 100, 6); // 30.5%: the target met
    expect(dayDryback(points, START, null)).toBeNull();
    expect(dayDryback([], START, 60.1)).toBeNull();
  });
  it("a controller not reporting gets no projection, only when it last reported", () => {
    const now = at("03:00:00");
    expect(unprojected(NOT_REPORTING, now - 12 * 60_000, now)).toBe(
      "no projection: last report 12 min ago",
    );
    expect(unprojected(NOT_REPORTING, null, now)).toBe(
      "no projection: no report from the controller",
    );
    expect(unprojected("the room is off", null, now)).toBe("not watering: the room is off");
    expect(unprojected(null, now, now)).toBeNull();
  });
  it("joins a week of day-sized requests into one history per entity", () => {
    const joined = joinRows([{ a: [row("2", 20)], b: [row("x", 5)] }, { a: [row("1", 10)] }]);
    expect(joined).toEqual({ a: [row("1", 10), row("2", 20)], b: [row("x", 5)] });
    expect(valueAt([row("8", 10), row("unavailable", 20), row("10", 30)], 25)).toBe(8);
    expect(valueAt([row("8", 10)], 5)).toBeNull();
  });
});

describe("the demo's earlier days", () => {
  it("run on from today's curve, with shots of their own", () => {
    const now = new Date(2026, 8, 23, 17, 0).getTime();
    const states = createDemo(now);
    const room = buildRoom(
      states,
      discoverRooms(states).find((item) => item.prefix === "")!,
    );
    const day = growDay(10, 22, now)!;
    const [yesterday] = earlierDays(day, 1, () => ({ on: 10, off: 22 }));
    const ids = earlierEntities(room, states);
    const before = demoDay(states, { ...ids, start: yesterday.start, end: yesterday.end }, now);
    const today = demoDay(states, { ...ids, start: day.start, end: now }, now);
    const vwc = "sensor.crop_steering_vwc_zone_1";
    // Yesterday ends where today begins, on the same curve.
    const last = before[vwc].at(-1)!,
      first = today[vwc][0];
    expect(Math.abs(Number(last.state) - Number(first.state))).toBeLessThan(0.5);
    // A room switched off now was on yesterday: that day still compares.
    const active = "switch.crop_steering_room_active";
    const off = demoDay(
      { ...states, [active]: { ...states[active], state: "off" } },
      { ...ids, start: yesterday.start, end: yesterday.end },
      now,
    );
    expect(off[active]).toEqual([row("on", yesterday.start)]);
    expect(dayTrace(off, { vwc, valve: null, active }, 1, yesterday)).not.toBeNull();
    const trace = dayTrace(
      before,
      { vwc, valve: "switch.demo_valve_1", active: null },
      1,
      yesterday,
    )!;
    expect(trace.shots.length).toBeGreaterThan(6);
    const seconds = (shots: Shot[]) => shots.map((item) => (item.end - item.start) / 1000);
    expect(seconds(trace.shots)).not.toEqual(
      seconds(valveShots(today["switch.demo_valve_1"], [], 1, day.start, now)).slice(
        0,
        trace.shots.length,
      ),
    );
  });
});

describe("durations", () => {
  it("reads like a person would say it", () => {
    expect(duration(40_000)).toBe("40 s");
    expect(duration(145_000)).toBe("2 min 25 s");
    expect(duration(120_000)).toBe("2 min");
    expect(duration(600_000)).toBe("10 min");
    expect(duration(72 * 60_000)).toBe("1 h 12 min");
    expect(duration(3_600_000)).toBe("1 h");
  });
});
