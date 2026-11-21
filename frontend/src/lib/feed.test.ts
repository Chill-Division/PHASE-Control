import { afterEach, describe, expect, it, vi } from "vitest";
import { HaClient } from "./client";
import { createDemo } from "./demo";
import { ControllerStore } from "./use-controller";
import {
  documentOf,
  draftErrors,
  draftOf,
  duration,
  levelPct,
  moveTo,
  newRecipe,
  addDays,
  heldUntil,
  inUse,
  partMl,
  pickStage,
  planOf,
  removeSchedule,
  scheduleWeek,
  doserOrder,
  canRefill,
  reminderPct,
  type FeedDocument,
  type FeedDraft,
} from "./feed";
import { FeedDemo, sampleFeed } from "./feed-demo";
import { OperatorDemo } from "./operator-demo";
import {
  fillRefusal,
  lastBatchWords,
  levelMm,
  readBatchStatus,
  timeLeft,
  type LastBatch,
} from "./feed-status";
import type { States } from "./types";

// Athena Flower as the owner runs it: 3 Core : 5 Bloom : 1 Balance : 0.5 Cleanse, 1.667 mL per litre
// per part, on doser 4 (Core), 3 (Bloom), 2 (Balance) and 1 (Cleanse), in 145 L. The integration's
// own test (tests/test_feed.py) gives the same numbers.
const flower = (change: Partial<FeedDraft> = {}): FeedDraft => ({
  fill_s: 621,
  batch_l: 145,
  full_mm: 125,
  empty_mm: 850,
  min_pct: 5,
  remind_pct: 20,
  pause_s: 10,
  mix_s: 10,
  leak_factor: 3,
  leak_min_l: 10,
  leak_hold: true,
  dosers: {},
  order: [4, 3, 2, 1],
  recipes: [
    {
      id: "flower",
      name: "Flower",
      strength: 5 / 3,
      doses: {
        "4": { label: "Core", parts: 3 },
        "3": { label: "Bloom", parts: 5 },
        "2": { label: "Balance", parts: 1 },
        "1": { label: "Cleanse", parts: 0.5 },
      },
      order: [4, 3, 2, 1],
    },
  ],
  stage: "flower",
  schedule: { start: null, weeks: [] },
  held_until: null,
  ...change,
});

describe("feed plan", () => {
  it("turns a ratio and a strength into each doser's mL and seconds, as the integration does", () => {
    const plan = planOf(flower(), [1, 2, 3, 4]);
    expect(plan.problem).toBeNull();
    expect(plan.doses.map((d) => [d.doser, d.label, d.ml, d.seconds])).toEqual([
      [4, "Core", 725, 72.5],
      [3, "Bloom", 1208, 120.8],
      [2, "Balance", 242, 24.2],
      [1, "Cleanse", 121, 12.1],
    ]);
    expect(plan.feed_ec).toBeNull();
    const mixed = flower();
    mixed.recipes[0].ec = 2.8;
    expect(planOf(mixed, [1, 2, 3, 4]).feed_ec).toBe(2.8); // as feed.py plan() publishes it
  });

  it("doses whole mL: 3 and 5 parts of 240 mL are 720 and 1,200, not 719.9 and 1,199.9", () => {
    // The owner's Bloom: 1.655 mL per litre per part in 145 L is 239.975 mL a part.
    const draft = flower();
    draft.recipes[0].strength = 1.655;
    const ml = Object.fromEntries(planOf(draft, [1, 2, 3, 4]).doses.map((d) => [d.label, d.ml]));
    expect(ml).toEqual({ Core: 720, Bloom: 1200, Balance: 240, Cleanse: 120 });
    // Set as 1 part = 240 mL, the strength is exactly what that takes in the fill.
    draft.recipes[0].strength = 240 / draft.batch_l;
    expect(partMl(draft, draft.recipes[0])).toBeCloseTo(240, 9);
  });

  it("doses in the recipe's own order, so a stage can use a doser the others leave out", () => {
    const draft = flower();
    draft.recipes.push({
      id: "fade",
      name: "Fade",
      strength: 1.655,
      doses: {
        "5": { label: "Fade", parts: 3 },
        "3": { label: "Bloom", parts: 0 },
        "2": { label: "Balance", parts: 1 },
        "1": { label: "Cleanse", parts: 0.5 },
      },
      order: [1, 5, 2],
    });
    draft.stage = "fade";
    expect(planOf(draft, [1, 2, 3, 4, 5]).doses.map((d) => d.label)).toEqual([
      "Cleanse",
      "Fade",
      "Balance",
    ]);
    draft.stage = "flower"; // Flower's order is its own
    expect(planOf(draft, [1, 2, 3, 4, 5]).doses.map((d) => d.doser)).toEqual([4, 3, 2, 1]);
  });

  it("gives a recipe saved before recipes had their own order the room's", () => {
    const old = { ...flower(), recipes: flower().recipes.map(({ order: _, ...r }) => r) };
    const draft = draftOf(old as unknown as FeedDocument);
    expect(draft.recipes[0].order).toEqual([4, 3, 2, 1]);
  });

  it("runs 750 mL of Bloom for 75 s at 600 mL/min, and longer on a slower doser", () => {
    const plan = planOf(sampleFeed(), [1, 2, 3, 4]);
    expect(plan.doses.find((d) => d.label === "Bloom")).toMatchObject({ ml: 750, seconds: 75 });
    const slow = planOf({ ...sampleFeed(), dosers: { "2": { flow_ml_min: 450 } } }, [1, 2, 3, 4]);
    expect(slow.doses.find((d) => d.label === "Bloom")?.seconds).toBe(100);
  });

  it("says why no batch can run", () => {
    expect(planOf(flower(), []).problem).toBe("No doser is mapped in Settings → Rooms & hardware.");
    expect(planOf(flower({ stage: null }), [1, 2, 3, 4]).problem).toBe("No feed stage is chosen.");
    expect(planOf(flower(), [1, 2, 4]).problem).toBe(
      "Flower uses doser 3, which has no switch in Settings → Rooms & hardware.",
    );
    const none = flower();
    none.recipes[0].strength = 0;
    expect(planOf(none, [1, 2, 3, 4]).problem).toBe(
      "Flower's strength is 0: nothing would be dosed.",
    );
  });

  it("keeps a recipe's order, then any other doser by number, and moves one", () => {
    expect(doserOrder([2], [1, 2, 3, 4])).toEqual([2, 1, 3, 4]);
    expect(doserOrder([6, 3], [1, 3])).toEqual([3, 1]);
    expect(moveTo([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveTo([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
    expect(moveTo([1, 2, 3, 4], 1, 1)).toEqual([1, 2, 3, 4]);
  });
});

describe("feed schedule", () => {
  // The owner's example: Week 1 Vege, Weeks 2-6 Bloom, Weeks 7-8 Fade, from Monday 5 October.
  const scheduled = (): FeedDraft => {
    const draft = flower({ stage: "vege" });
    draft.recipes.push(
      { ...draft.recipes[0], id: "vege", name: "Vege" },
      { ...draft.recipes[0], id: "fade", name: "Fade" },
    );
    draft.schedule = {
      start: "2026-10-05",
      weeks: ["vege", ...Array(5).fill("flower"), "fade", "fade"],
    };
    return draft;
  };

  it("gives each week its recipe, as feed.py does, and the last carries on", () => {
    const draft = scheduled();
    expect(scheduleWeek(draft, "2026-10-04")).toBeNull(); // not begun
    expect(
      ["2026-10-05", "2026-10-11", "2026-10-12", "2026-11-15", "2026-11-16", "2026-11-29"].map(
        (d) => inUse(draft, d),
      ),
    ).toEqual(["vege", "vege", "flower", "flower", "fade", "fade"]);
    expect(scheduleWeek(draft, "2026-12-14")).toEqual({ week: 11, recipe: "fade" });
    const plan = planOf(draft, [1, 2, 3, 4], "2026-10-14");
    expect([plan.stage, plan.week, plan.weeks, plan.source]).toEqual(["Flower", 2, 8, "schedule"]);
  });

  it("holds a stage picked by hand only until the schedule's next week", () => {
    const draft = pickStage(scheduled(), "fade", "2026-10-14");
    expect(draft.held_until).toBe("2026-10-19");
    expect(heldUntil(draft, "2026-10-14")).toBe("2026-10-19");
    expect(planOf(draft, [1, 2, 3, 4], "2026-10-14").source).toBe("held");
    expect(inUse(draft, "2026-10-19")).toBe("flower");
    expect(pickStage(draft, "flower", "2026-10-14").held_until).toBeNull();
    expect(pickStage(flower(), "flower", "2026-10-14").held_until).toBeNull(); // no schedule
  });

  it("keeps the stage in use when the schedule is removed", () => {
    const draft = removeSchedule(scheduled(), "2026-10-14");
    expect(draft.schedule).toEqual({ start: null, weeks: [] });
    expect(draft.stage).toBe("flower");
    expect(planOf(draft, [1, 2, 3, 4], "2026-10-14").source).toBe("hand");
  });

  it("says a week whose recipe is removed needs another", () => {
    const draft = scheduled();
    draft.recipes = draft.recipes.filter((r) => r.id !== "fade");
    expect(draftErrors(draft)).toContain(
      "Weeks 7, 8 of the feed schedule use a recipe that is removed: choose another.",
    );
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});

describe("feed checks", () => {
  it("says what the integration would refuse before it is sent", () => {
    expect(draftErrors(flower())).toEqual([]);
    expect(draftErrors(flower({ fill_s: 12.5 })).join()).toMatch(
      /Fresh-water fill must be a whole/,
    );
    expect(draftErrors(flower({ batch_l: Number.NaN })).join()).toMatch(/Fill litres/);
    expect(draftErrors(flower({ dosers: { "2": { flow_ml_min: 0 } } })).join()).toMatch(
      /Doser 2's flow/,
    );
    const twice = flower();
    twice.recipes.push({ ...twice.recipes[0], id: "b", name: "flower" });
    expect(draftErrors(twice)).toContain("Two feed recipes are called flower.");
    const strong = flower();
    strong.recipes[0].strength = 7;
    expect(draftErrors(strong).join()).toMatch(/comes to 66\.5 mL per litre/);
    const unnamed = flower();
    unnamed.recipes[0].doses["4"].label = " ";
    expect(draftErrors(unnamed)).toContain("Flower: doser 4 has parts but no nutrient.");
    // A feed EC is optional: none, or one from 0.1 to 10 mS/cm, as feed.py takes it.
    for (const ec of [null, undefined, 0.1, 2.8, 10]) {
      const given = flower();
      given.recipes[0].ec = ec;
      expect(draftErrors(given)).toEqual([]);
    }
    for (const ec of [0.05, 12, Number.NaN]) {
      const wrong = flower();
      wrong.recipes[0].ec = ec;
      expect(draftErrors(wrong)).toContain(
        "Flower: the feed EC must be from 0.1 to 10 mS/cm, or left empty.",
      );
    }
  });

  it("starts a new recipe with the bottles the last one had, no parts, and its own id", () => {
    const recipe = newRecipe(flower(), [1, 2, 3, 4], "Fade");
    expect(recipe.name).toBe("Fade");
    expect(recipe.id).toMatch(/^[a-f0-9]{12}$/);
    expect(recipe.doses["3"]).toEqual({ label: "Bloom", parts: 0 });
    expect(recipe.order).toEqual([4, 3, 2, 1]); // and the order they dose in
    expect(recipe.ec).toBeNull(); // measured once it is mixed
  });

  it("sends names and nutrients as the integration keeps them", () => {
    const draft = flower();
    draft.recipes[0].name = "  Late   flower ";
    draft.recipes[0].doses["4"].label = " Core ";
    const sent = documentOf(draft);
    expect(sent.recipes[0].name).toBe("Late flower");
    expect(sent.recipes[0].doses["4"].label).toBe("Core");
  });

  it("reads durations in minutes and seconds", () => {
    expect(duration(45)).toBe("45 s");
    expect(duration(12.1)).toBe("12.1 s");
    expect(duration(600)).toBe("10 min");
    expect(duration(90)).toBe("1 min 30 s");
  });
});

describe("batch status", () => {
  const states = (state: string, attributes: Record<string, unknown>): States => ({
    "sensor.crop_steering_batch_status": {
      entity_id: "sensor.crop_steering_batch_status",
      state,
      attributes,
    },
  });

  it("reads what the controller reports, and nothing when it has not", () => {
    expect(readBatchStatus({}, "")).toBeNull();
    const status = readBatchStatus(
      states("dosing", {
        stage: "Flower",
        until: "2026-09-27T14:01:10+12:00",
        doser: 3,
        nutrient: "Bloom",
        doses: [{ doser: 3, label: "Bloom", ml: 750, seconds: 75, dosed: null }, { bad: 1 }],
        level_mm: 210.4,
        level_pct: 88.2,
        full_mm: 125,
        empty_mm: 850,
        min_pct: 5,
        litres_per_pct: 2.07,
        due: false,
        next_round_l: 7.68,
        auto: true,
        armed: false,
        last: {
          at: "2026-09-26T18:00:00+12:00",
          result: "done",
          stage: "Flower",
          dosed: { "3": 750 },
        },
        blocked: null,
      }),
      "",
    )!;
    expect(status.step).toBe("dosing");
    expect(status.until).toBe(Date.parse("2026-09-27T02:01:10Z"));
    expect(status.doses).toEqual([{ doser: 3, label: "Bloom", ml: 750, seconds: 75, dosed: null }]);
    // A record from an older controller: its dosers by number, no names or order.
    expect(status.last).toMatchObject({ result: "done", dosed: { "3": 750 }, doses: null });
    expect(lastBatchWords(status.last!)).toBe("doser 3 750 mL");
    expect([status.auto, status.armed, status.blocked]).toEqual([true, false, null]);
    expect([status.levelPct, status.minPct, status.litresPerPct, status.due]).toEqual([
      88.2,
      5,
      2.07,
      false,
    ]);
    expect(readBatchStatus(states("unavailable", {}), "")!.step).toBeNull();
    // A controller from before the level reports none of it.
    const old = readBatchStatus(states("settling", { level_mm: 640, empty_mm: 800 }), "")!;
    expect([old.step, old.levelPct, old.due, old.litresPerPct]).toEqual([
      "settling",
      null,
      null,
      null,
    ]);
    // Nor of the leak check, whose learned draw and hold come with it.
    expect([old.usualDraw, old.leakHold]).toEqual([null, null]);
    const held = readBatchStatus(
      states("idle", {
        usual_draw: 0.7,
        leak_hold: {
          at: "2026-11-21T11:00:30",
          litres: 7.2,
          shots: 1,
          took: 20,
          usual: 5.04,
          per_pct: 2.07,
        },
      }),
      "",
    )!;
    expect(held.usualDraw).toBe(0.7);
    expect(held.leakHold).toEqual({
      at: Date.parse("2026-11-21T11:00:30"),
      litres: 7.2,
      took: 20,
      usual: 5.04,
      perPct: 2.07,
    });
  });

  it("reads the level sensor in mm as the controller does, before the controller reports", () => {
    const sensor = (state: string, unit?: string) => ({
      entity_id: "sensor.res_distance",
      state,
      attributes: unit === undefined ? {} : { unit_of_measurement: unit },
    });
    expect(levelMm(sensor("84.6", "cm"))).toBeCloseTo(846);
    expect(levelMm(sensor("0.85", "m"))).toBeCloseTo(850);
    expect(levelMm(sensor("850"))).toBe(850);
    expect(levelMm(sensor("850", "in"))).toBeNull();
    expect(levelMm(sensor("unavailable", "mm"))).toBeNull();
    expect(levelMm(undefined)).toBeNull();
  });

  it("works the level out between the distances when full and empty, as the controller does", () => {
    expect(levelPct(125, 125, 850)).toBe(100);
    expect(levelPct(850, 125, 850)).toBe(0);
    expect(levelPct(487.5, 125, 850)).toBeCloseTo(50);
    expect(levelPct(90, 125, 850)).toBe(100); // clamped, as the ESPHome template did
    expect(levelPct(900, 125, 850)).toBe(0);
    expect(levelPct(null, 125, 850)).toBeNull();
    expect(levelPct(500, 0, 850)).toBeNull(); // both distances, or no level
    expect(levelPct(500, 850, 125)).toBeNull();
  });

  it("refuses a refill asked for by hand that could overflow, as the controller would", () => {
    // Once a refill has shown what 1% holds, the fill must fit.
    expect(fillRefusal(25, true, 145, 5, 145 / 70)).toBeNull();
    expect(fillRefusal(40, true, 145, 5, 145 / 70)).toBe(
      "The reservoir reads 40%, and its 145 L fill adds about 70%, so it could overflow.",
    );
    // Before that, only from 10% (or the minimum, if higher).
    expect(fillRefusal(9, true, 145, 5, null)).toBeNull();
    expect(fillRefusal(25, true, 145, 5, null)).toContain("starts only from 10% or less");
    expect(fillRefusal(12, true, 145, 15, null)).toBeNull();
    // A level set up that reads nothing could be anything; without one there is nothing to check.
    expect(fillRefusal(null, true, 145, 5, null)).toBe(
      "The level sensor has no reading, so a fill could overflow it.",
    );
    expect(fillRefusal(null, false, 145, 5, null)).toBeNull();
  });

  it("starts an older integration's settings at feed.py's defaults", () => {
    const old = { ...documentOf(flower()), full_mm: undefined, min_pct: undefined } as never;
    const draft = draftOf(old);
    expect([draft.full_mm, draft.min_pct, draft.empty_mm]).toEqual([0, 5, 850]);
    // One from before the leak check: its controller checks at 3 times, 10 L, and holds.
    const before = {
      ...documentOf(flower()),
      leak_factor: undefined,
      leak_min_l: undefined,
      leak_hold: undefined,
    } as never;
    const leak = draftOf(before);
    expect([leak.leak_factor, leak.leak_min_l, leak.leak_hold]).toEqual([3, 10, true]);
  });

  it("refuses a leak factor that would call ordinary shots leaks, and carries the hold to the plan", () => {
    expect(draftErrors(flower({ leak_factor: 1.2 }))).toContain(
      "The leak factor must be 0 (off) or at least 1.5: under that, ordinary shots would read as leaks.",
    );
    expect(draftErrors(flower({ leak_factor: 0 }))).toEqual([]);
    expect(draftErrors(flower({ leak_factor: 1.5 }))).toEqual([]);
    expect(draftErrors(flower({ leak_factor: 25 }))).toContain(
      "Leak factor must be a number from 0 to 20.",
    );
    expect(draftErrors(flower({ leak_min_l: 600 }))).toContain(
      "Leak litres must be a number from 0 to 500 L.",
    );
    const plan = planOf(flower({ leak_factor: 4, leak_min_l: 20, leak_hold: false }), [1, 2, 3, 4]);
    expect([plan.leak_factor, plan.leak_min_l, plan.leak_hold]).toEqual([4, 20, false]);
  });

  it("says when the distance when full is not the smaller one", () => {
    expect(draftErrors(flower({ full_mm: 850, empty_mm: 125 }))).toContain(
      "The distance when full must be less than the distance when empty: the level sensor is above the water, so it reads further as the reservoir empties.",
    );
    expect(draftErrors(flower({ full_mm: 0, empty_mm: 0 }))).toEqual([]);
  });

  it("counts down to the end of the step", () => {
    const now = Date.parse("2026-09-27T02:00:00Z");
    expect(timeLeft(now + 200_000, now)).toBe("3 min 20 s left");
    expect(timeLeft(now + 42_300, now)).toBe("43 s left");
    expect(timeLeft(now - 1, now)).toBeNull();
  });
});

describe("demo feed services", () => {
  const room = "room:";
  const rig = () => {
    let current: States = {
      "sensor.crop_steering_engine_config": {
        entity_id: "sensor.crop_steering_engine_config",
        state: "ready",
        attributes: {
          prefix: "",
          fresh_water_switch: "switch.fresh",
          doser_1_switch: "switch.d1",
          doser_2_switch: "switch.d2",
          doser_3_switch: "switch.d3",
          doser_4_switch: "switch.d4",
        },
      },
      "switch.fresh": { entity_id: "switch.fresh", state: "off", attributes: {} },
      "sensor.crop_steering_batch_status": {
        entity_id: "sensor.crop_steering_batch_status",
        state: "idle",
        attributes: { auto: false },
      },
    };
    const demo = new FeedDemo(
      () => current,
      (next) => (current = next),
    );
    return { demo, states: () => current };
  };

  it("saves like the integration, refusing a stale revision and what it would not accept", () => {
    const { demo, states } = rig();
    let doc = demo.call("feed_get", { room_id: room });
    expect(doc.plan.stage).toBe("Flower");
    expect(() =>
      demo.call("feed_save", { room_id: room, expected_revision: 99, document: sampleFeed() }),
    ).toThrow(/changed elsewhere/);
    expect(() =>
      demo.call("feed_save", {
        room_id: room,
        expected_revision: doc.revision,
        document: { ...sampleFeed(), batch_l: 0 },
      }),
    ).toThrow(/Fill litres/);
    doc = demo.call("feed_save", {
      room_id: room,
      expected_revision: doc.revision,
      document: {
        ...sampleFeed(),
        batch_l: 300,
        recipes: sampleFeed().recipes.map((r) => ({ ...r, order: [2, 1, 3, 4] })),
      },
    });
    expect(doc.plan.doses.map((d) => [d.doser, d.ml])).toEqual([
      [2, 1500],
      [1, 900],
      [3, 300],
      [4, 150],
    ]);
    expect(states()["sensor.crop_steering_feed_plan"].state).toBe("Flower");
    expect(states()["select.crop_steering_feed_stage"].attributes.options).toEqual(["Flower"]);
  });

  it("presses a zone's Test Shot button, as Home Assistant would", async () => {
    const { states } = rig();
    let current = states();
    const demo = new OperatorDemo(
      () => current,
      (next) => {
        current = next;
      },
    );
    const pressed = await demo.call<{ requested: string }>("test_shot", {
      room_id: "room:",
      zone: 2,
    });
    expect(current["button.crop_steering_zone_2_test_shot"].state).toBe(pressed.requested);
  });

  it("starts a batch asked for as the controller would, filling first", () => {
    const { demo, states } = rig();
    const doc = demo.call("feed_mix", { room_id: room });
    expect(doc.requested).toBeTruthy();
    expect(states()["sensor.crop_steering_batch_status"].state).toBe("filling");
    expect(states()["switch.fresh"].state).toBe("on");
  });
});

describe("feed actions in the dashboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("are for the room selected, whatever the page sends, and a read changes nothing", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) || null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal("window", {
      location: { origin: "http://x.test", hostname: "x.test", href: "http://x.test/", search: "" },
      history: { replaceState: vi.fn() },
    });
    vi.spyOn(HaClient.prototype, "states").mockResolvedValue(createDemo());
    const operator = vi.spyOn(HaClient.prototype, "operator").mockResolvedValue({ revision: 1 });
    const store = new ControllerStore(false);
    await store.connect("http://x.test", "token");
    store.changeRoom("room:f1_");
    const refresh = vi.spyOn(store, "refresh");
    await store.operator("feed_get");
    expect(refresh).not.toHaveBeenCalled();
    await store.operator("feed_mix", { room_id: "room:" });
    await store.operator("test_shot", { room_id: "room:", zone: 2 });
    expect(operator.mock.calls).toEqual([
      ["feed_get", { room_id: "room:f1_" }],
      ["feed_mix", { room_id: "room:f1_" }],
      ["test_shot", { room_id: "room:f1_", zone: 2 }],
    ]);
    expect(refresh).toHaveBeenCalledTimes(2); // each asked for: the new button state
    store.disconnect();
  });
});

describe("the last batch, in words", () => {
  const last = (doses: LastBatch["doses"], result = "done"): LastBatch => ({
    at: null,
    result,
    stage: "Bloom",
    dosed: {},
    doses,
  });
  const dose = (doser: number, label: string, ml: number, given: number | null) => ({
    doser,
    label,
    ml,
    given,
  });
  it("names each nutrient, in the order it went in, at the recipe's amount", () => {
    expect(
      lastBatchWords(
        last([
          dose(3, "Balance", 252, 252),
          dose(6, "Bloom", 1200, 1200),
          dose(5, "Core", 720, 720),
          dose(2, "Cleanse", 120, 120),
        ]),
      ),
    ).toBe("Balance 252 mL · Bloom 1,200 mL · Core 720 mL · Cleanse 120 mL");
  });
  it("says what a dose cut short gave, and which never went in", () => {
    const stopped = last(
      [
        dose(3, "Balance", 252, 252),
        dose(6, "Bloom", 1200, 600),
        dose(5, "Core", 720, null),
        dose(2, "", 120, null),
      ],
      "stopped: watering was switched off",
    );
    expect(lastBatchWords(stopped)).toBe(
      "Balance 252 mL · Bloom 600 of 1,200 mL · Core and doser 2 not dosed",
    );
    expect(lastBatchWords(last([]))).toBe("Nothing dosed");
  });
  it("names an older controller's dosers from the stage's recipe, in its dosing order", () => {
    // GR2's 4 October batch, recorded by doser number before the controller kept names.
    const old = { ...last(null), dosed: { "2": 121, "3": 253, "5": 721, "6": 1201 } };
    const bloom = {
      id: "bloom",
      name: "Bloom",
      strength: 1.6552,
      doses: {
        "2": { label: "Cleanse", parts: 0.5 },
        "3": { label: "Balance", parts: 1.05 },
        "5": { label: "Core", parts: 3 },
        "6": { label: "Bloom", parts: 5 },
      },
      order: [3, 6, 5, 2],
    };
    expect(lastBatchWords(old, [bloom])).toBe(
      "Balance 253 mL · Bloom 1,201 mL · Core 721 mL · Cleanse 121 mL",
    );
    // Without that recipe here any more, by number, as recorded.
    expect(lastBatchWords(old, [])).toBe(
      "doser 2 121 mL · doser 3 253 mL · doser 5 721 mL · doser 6 1,201 mL",
    );
  });
});

describe("a refill by hand", () => {
  it("is offered only with a fresh-water solenoid, a recirculation solenoid, the pump and a doser", () => {
    const room: Record<string, unknown> = {
      fresh_water_switch: "switch.fresh",
      recirc_switch: "switch.recirc",
      pump: "switch.pump",
      doser_3_switch: "switch.doser_3",
    };
    expect(canRefill(room)).toBe(true);
    for (const missing of Object.keys(room))
      expect(canRefill({ ...room, [missing]: "" }), missing).toBe(false);
    expect(canRefill({})).toBe(false);
  });
});

describe("the refill reminder", () => {
  it("comes only while nothing refills the reservoir by itself, and above its minimum", () => {
    expect(reminderPct(20, 5, false, true)).toBe(20); // automatic refills off
    expect(reminderPct(20, 5, null, true)).toBe(20); // unreadable: off, as to the controller
    expect(reminderPct(20, 5, true, true)).toBeNull(); // automatic refills keep it up
    expect(reminderPct(20, 5, true, false)).toBe(20); // on, but nothing to refill it with
    expect(reminderPct(5, 5, false, true)).toBeNull(); // at the minimum, watering waits instead
    expect(reminderPct(0, 0, false, true)).toBeNull(); // turned off
    expect(reminderPct(undefined, 5, false, true)).toBeNull(); // an integration from before it
  });
});
