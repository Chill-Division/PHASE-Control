import { createUuid } from "./uuid";

/** A room's nutrient batches, as the integration's feed services return them (feed.py, feed_api.py):
 * the reservoir's batch settings, the dosers' flow, and a feed recipe for each growth stage, with the
 * order its dosers dose in. The amounts: a recipe gives each doser's nutrient a number of parts, and a
 * strength in mL per litre per part; the fill's litres scale them, to the whole mL. A doser runs for
 * its mL at its flow (600 mL/min unless set). */

export interface FeedDose {
  label: string;
  parts: number;
}
export interface FeedRecipe {
  id: string;
  name: string;
  /** mL per litre per part. */
  strength: number;
  /** By doser number ("1" to "6"). */
  doses: Record<string, FeedDose>;
  /** The order its dosers dose in; any other doser follows, by number (feed.py recipe_order). */
  order: number[];
  /** What it mixes to, mS/cm, as measured once mixed; null (or missing, from before) when not given.
   * The controller takes the recipe in use's as the feed's EC (feed.py FEED_EC). */
  ec?: number | null;
}
/** A feed EC a recipe accepts, mS/cm (feed.py FEED_EC). */
export const FEED_EC: [number, number] = [0.1, 10];
export interface PlannedDose {
  doser: number;
  label: string;
  ml: number;
  seconds: number;
}
export interface FeedSettings {
  fill_s: number;
  /** The litres the fill adds: what the doses are worked out for. */
  batch_l: number;
  /** The level sensor's distance to the water when full, and when empty; 0 = not set. */
  full_mm: number;
  empty_mm: number;
  /** The least the reservoir keeps, %: a refill comes before a shot that would take it lower. */
  min_pct: number;
  /** While nothing refills it by itself, the level a person is reminded to refill it by hand at, %;
   * 0 = off. */
  remind_pct: number;
  pause_s: number;
  mix_s: number;
  /** The leak check: a shot is leaky at this many times how far this room's shots usually take the
   * reservoir's level down (0 = off, else LEAK_FACTOR_LOWEST or more)... */
  leak_factor: number;
  /** ...and at least these litres more (feed.py SETTINGS). */
  leak_min_l: number;
}
export interface FeedPlan extends FeedSettings {
  /** Whether the second leaky shot in a row holds watering (CS-709); missing from an older
   * integration, whose controller holds. */
  leak_hold?: boolean;
  stage: string | null;
  stage_id: string | null;
  /** The stage's feed EC, mS/cm, or null when its recipe gives none. */
  feed_ec?: number | null;
  doses: PlannedDose[];
  /** Why no batch can run, or null. */
  problem: string | null;
  /** The feed schedule's week today (null without one running), and how many it has. */
  week?: number | null;
  weeks?: number;
  schedule_start?: string | null;
  /** Until when a stage picked by hand holds over the schedule, or null. */
  held_until?: string | null;
  /** How the stage in use came: the schedule's week, held by hand, or picked by hand. */
  source?: "schedule" | "held" | "hand";
}
/** Each week of the grow's recipe, by id, from the day Week 1 starts (YYYY-MM-DD). */
export interface FeedSchedule {
  start: string | null;
  weeks: string[];
}
/** What the editor changes and feed_save takes. */
export interface FeedDraft extends FeedSettings {
  /** The second leaky shot in a row holds watering (CS-709); off, the leak check only warns. */
  leak_hold: boolean;
  dosers: Record<string, { flow_ml_min: number }>;
  /** The room's dosing order from before each recipe had its own: a recipe without one takes it. */
  order: number[];
  recipes: FeedRecipe[];
  /** The recipe picked by hand, by id: the stage in use without a schedule running. */
  stage: string | null;
  schedule: FeedSchedule;
  /** A stage picked by hand while the schedule runs holds until this day (YYYY-MM-DD). */
  held_until: string | null;
}
export interface FeedDocument extends FeedDraft {
  schema_version: 1;
  room_id: string;
  revision: number;
  /** The room's doser switches from Rooms & hardware, by doser number. */
  mapped: Record<string, string>;
  plan: FeedPlan;
  max_dosers: number;
  max_recipes: number;
  error: string | null;
  /** feed_mix only: when the room's Mix a Batch Now button was pressed. */
  requested?: string | null;
}

/** The room's reservoir and dosers in Rooms & hardware (room.py RESERVOIR_KEYS). */
export const MAX_DOSERS = 6;
export const DOSER_KEYS = Array.from({ length: MAX_DOSERS }, (_, i) => `doser_${i + 1}_switch`);
export const BATCH_SWITCH_KEYS = ["fresh_water_switch", "recirc_switch", ...DOSER_KEYS];
export const RESERVOIR_KEYS = ["reservoir_distance_sensor", ...BATCH_SWITCH_KEYS];
/** Whether the room has what a refill needs, from its descriptor: a fresh-water solenoid, a
 * recirculation solenoid, the room's pump and a doser (controller.py _batch_refusal). Without them
 * no refill can run, so nothing offers one. */
export function canRefill(attributes: Record<string, unknown>): boolean {
  const mapped = (key: string) => typeof attributes[key] === "string" && !!attributes[key];
  return (
    mapped("fresh_water_switch") &&
    mapped("recirc_switch") &&
    mapped("pump") &&
    DOSER_KEYS.some(mapped)
  );
}
/** The level the controller reminds a person to refill the reservoir by hand at (CS-706), or null
 * where it does not: automatic refills keep it up (on, in a room that can refill), or the reminder is
 * off, or at or under the minimum, where watering waits for a refill instead. Unreadable, the
 * Automatic refills switch counts as off, as it does to the controller. */
export function reminderPct(
  remind: unknown,
  minimum: number,
  auto: boolean | null,
  refillable: boolean,
): number | null {
  const level = Number(remind);
  return Number.isFinite(level) && level > 0 && level > minimum && !(refillable && auto === true)
    ? level
    : null;
}
export const DEFAULT_FLOW = 600;
export const MAX_ML_PER_L = 60;
export const NAME_LEN = 40;
/** field -> [label, unit, lowest, highest, whole number], as feed.py SETTINGS checks them. */
export const SETTINGS: Record<keyof FeedSettings, [string, string, number, number, boolean]> = {
  fill_s: ["Fresh-water fill", "s", 10, 7200, true],
  batch_l: ["Fill litres", "L", 1, 5000, false],
  full_mm: ["Distance when full", "mm", 0, 10000, false],
  empty_mm: ["Distance when empty", "mm", 0, 10000, false],
  min_pct: ["Minimum level", "%", 0, 50, false],
  remind_pct: ["Remind me at", "%", 0, 90, false],
  pause_s: ["Pause between dosers", "s", 0, 600, true],
  mix_s: ["Recirculate after the last dose", "s", 0, 7200, true],
  leak_factor: ["Leak factor", "×", 0, 20, false],
  leak_min_l: ["Leak litres", "L", 0, 500, false],
};
/** The leak check's settings, shown in their own section: the rest are the refill's. */
export const LEAK_SETTINGS: (keyof FeedSettings)[] = ["leak_factor", "leak_min_l"];
/** Under this, ordinary shots would read as leaky (feed.py LEAK_FACTOR_LOWEST). */
export const LEAK_FACTOR_LOWEST = 1.5;
/** An integration older than the reservoir's level sends none of these: they start as feed.py's. */
const SETTING_DEFAULTS: Partial<FeedSettings> = {
  full_mm: 0,
  empty_mm: 0,
  min_pct: 5,
  remind_pct: 20,
  mix_s: 10,
  leak_factor: 3,
  leak_min_l: 10,
};

/** How full the reservoir is, %, as the controller works it out (controller.py level_pct): 100 at
 * the distance when full, 0 at the distance when empty, clamped between. null without a reading or
 * without both distances in the right order. */
export function levelPct(mm: number | null, fullMm: number, emptyMm: number): number | null {
  if (mm === null || !Number.isFinite(mm) || !(fullMm > 0 && fullMm < emptyMm)) return null;
  const clamped = Math.min(Math.max(mm, fullMm), emptyMm);
  return 100 - ((clamped - fullMm) / (emptyMm - fullMm)) * 100;
}
/** The nutrient names the recipe editor offers; anything else can be typed. */
export const NUTRIENT_LINES: Record<string, string[]> = {
  Athena: ["Core", "Grow", "Bloom", "Fade", "Balance", "Cleanse"],
  "Front Row": ["Part A", "Part B", "Bloom", "PhosZyme", "Front Row Si", "Triologic", "BioFlo"],
};
export const STAGE_NAMES = ["Vege", "Flower", "Bloom", "Fade"];

export const draftOf = (doc: FeedDocument): FeedDraft =>
  structuredClone({
    fill_s: doc.fill_s,
    batch_l: doc.batch_l,
    full_mm: doc.full_mm ?? SETTING_DEFAULTS.full_mm!,
    empty_mm: doc.empty_mm ?? SETTING_DEFAULTS.empty_mm!,
    min_pct: doc.min_pct ?? SETTING_DEFAULTS.min_pct!,
    remind_pct: doc.remind_pct ?? SETTING_DEFAULTS.remind_pct!,
    pause_s: doc.pause_s,
    mix_s: doc.mix_s ?? SETTING_DEFAULTS.mix_s!,
    // An integration from before the leak check sends none: its controller checks at these.
    leak_factor: doc.leak_factor ?? SETTING_DEFAULTS.leak_factor!,
    leak_min_l: doc.leak_min_l ?? SETTING_DEFAULTS.leak_min_l!,
    leak_hold: doc.leak_hold ?? true,
    dosers: doc.dosers,
    order: doc.order,
    // An integration from before each recipe had its own order sends the room's.
    recipes: doc.recipes.map((recipe) => ({ ...recipe, order: recipe.order ?? doc.order ?? [] })),
    stage: doc.stage,
    // And one from before the feed schedule, none.
    schedule: doc.schedule ?? { start: null, weeks: [] },
    held_until: doc.held_until ?? null,
  });

export const mappedNumbers = (mapped: Record<string, string>) =>
  Object.keys(mapped)
    .map(Number)
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);

/** The room's dosers in a recipe's order: those in `order` first, then any other by number. */
export function doserOrder(order: number[], mapped: number[]): number[] {
  const first = order.filter((n) => mapped.includes(n));
  return [...first, ...mapped.filter((n) => !first.includes(n)).sort((a, b) => a - b)];
}

/** `order` with the item at `from` moved to `to`. */
export function moveTo<T>(order: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= order.length) return order;
  const next = [...order];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

export const flowOf = (draft: Pick<FeedDraft, "dosers">, doser: number) =>
  draft.dosers[String(doser)]?.flow_ml_min ?? DEFAULT_FLOW;

const round1 = (value: number) => Math.round(value * 10) / 10;

/** One part of a recipe in this fill, mL: its strength times the fill's litres. */
export const partMl = (draft: Pick<FeedDraft, "batch_l">, recipe: FeedRecipe) =>
  recipe.strength * draft.batch_l;

/** One doser's dose in a recipe at this batch size: mL, to the whole mL as feed.py doses it, and
 * seconds at the doser's flow. */
export function doseOf(draft: FeedDraft, recipe: FeedRecipe, doser: number) {
  const parts = recipe.doses[String(doser)]?.parts ?? 0;
  const ml = Math.round(parts * recipe.strength * draft.batch_l);
  const flow = flowOf(draft, doser);
  return { ml, seconds: flow > 0 ? round1((ml / flow) * 60) : 0 };
}

const DAY_MS = 86_400_000;
/** Today on this device, YYYY-MM-DD. */
export function localDay(at = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
const dayNumber = (day: string) =>
  Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** `day` (YYYY-MM-DD) and `days` later. */
export const addDays = (day: string, days: number) => dayOf(dayNumber(day) + days * DAY_MS);
export const MAX_WEEKS = 52;

/** feed.py schedule_week(): the feed schedule's week on `today` and the recipe it doses then, or
 * null without a schedule (no first day, or no weeks) or before it starts. After its last week, the
 * last week's recipe carries on. */
export function scheduleWeek(
  draft: Pick<FeedDraft, "schedule">,
  today: string,
): { week: number; recipe: string } | null {
  const { start, weeks } = draft.schedule ?? { start: null, weeks: [] };
  if (!start || !weeks.length) return null;
  const days = Math.round((dayNumber(today) - dayNumber(start)) / DAY_MS);
  if (days < 0) return null;
  const week = Math.floor(days / 7) + 1;
  return { week, recipe: weeks[Math.min(week, weeks.length) - 1] };
}
/** The day the schedule's `week` starts. */
export const weekStarts = (draft: Pick<FeedDraft, "schedule">, week: number) =>
  addDays(draft.schedule.start!, 7 * (week - 1));
/** feed.py held(): until when a stage picked by hand holds over the schedule, or null. */
export function heldUntil(draft: Pick<FeedDraft, "schedule" | "held_until">, today: string) {
  return draft.held_until && scheduleWeek(draft, today) && today < draft.held_until
    ? draft.held_until
    : null;
}
/** feed.py in_use(): the recipe in use on `today`, by id. */
export function inUse(draft: FeedDraft, today: string): string | null {
  const now = scheduleWeek(draft, today);
  return !now || heldUntil(draft, today) ? draft.stage : now.recipe;
}
/** feed.py pick(): a stage picked by hand holds, with the schedule running, until its next week
 * starts (this week's own recipe ends a hold); without one, it is the stage. */
export function pickStage(draft: FeedDraft, id: string | null, today: string): FeedDraft {
  const now = scheduleWeek(draft, today);
  return {
    ...draft,
    stage: id,
    held_until: now && id !== now.recipe ? weekStarts(draft, now.week + 1) : null,
  };
}
/** No schedule any more: the stage in use today stays, picked by hand from now on. */
export const removeSchedule = (draft: FeedDraft, today: string): FeedDraft => ({
  ...draft,
  stage: inUse(draft, today),
  schedule: { start: null, weeks: [] },
  held_until: null,
});

/** feed.py plan(): what the next batch would dose, in its recipe's order, or why none can run. */
export function planOf(draft: FeedDraft, mapped: number[], today = localDay()): FeedPlan {
  const id = inUse(draft, today);
  const stage = draft.recipes.find((r) => r.id === id) ?? null;
  const doses: PlannedDose[] = [];
  let problem: string | null = null;
  if (!mapped.length) problem = "No doser is mapped in Settings → Rooms & hardware.";
  else if (!stage) problem = "No feed stage is chosen.";
  else {
    const wanted = Object.entries(stage.doses)
      .filter(([, dose]) => dose.parts > 0)
      .map(([n]) => Number(n));
    const missing = wanted.filter((n) => !mapped.includes(n)).sort((a, b) => a - b);
    if (missing.length)
      problem = `${stage.name} uses doser ${missing[0]}, which has no switch in Settings → Rooms & hardware.`;
    else if (!wanted.length)
      problem = `${stage.name} doses nothing: give its nutrients some parts.`;
    for (const n of doserOrder(stage.order ?? draft.order, mapped))
      if (wanted.includes(n))
        doses.push({ doser: n, label: stage.doses[String(n)].label, ...doseOf(draft, stage, n) });
    if (!problem && !doses.some((d) => d.ml > 0))
      problem = `${stage.name}'s strength is 0: nothing would be dosed.`;
  }
  const now = scheduleWeek(draft, today),
    held = heldUntil(draft, today);
  return {
    stage: stage?.name ?? null,
    stage_id: stage?.id ?? null,
    feed_ec: stage?.ec ?? null,
    ...Object.fromEntries(Object.keys(SETTINGS).map((k) => [k, draft[k as keyof FeedSettings]])),
    leak_hold: draft.leak_hold,
    doses,
    problem,
    week: now?.week ?? null,
    weeks: draft.schedule?.weeks.length ?? 0,
    schedule_start: draft.schedule?.start ?? null,
    held_until: held,
    source: held ? "held" : now ? "schedule" : "hand",
  } as FeedPlan;
}

/** A recipe's total mL per litre. */
export const perLitre = (recipe: FeedRecipe) =>
  recipe.strength * Object.values(recipe.doses).reduce((sum, dose) => sum + (dose.parts || 0), 0);

const inRange = (value: number, low: number, high: number, whole = false) =>
  Number.isFinite(value) && value >= low && value <= high && (!whole || Number.isInteger(value));

/** The checks feed.py clean() makes, so the editor can say so before saving. */
export function draftErrors(draft: FeedDraft, maxRecipes = 12): string[] {
  const errors: string[] = [];
  for (const [key, [label, unit, low, high, whole]] of Object.entries(SETTINGS))
    if (!inRange(draft[key as keyof FeedSettings], low, high, whole))
      errors.push(
        `${label} must be ${whole ? "a whole number" : "a number"} from ${low} to ${high}${unit === "×" ? "" : ` ${unit}`}.`,
      );
  if (draft.leak_factor > 0 && draft.leak_factor < LEAK_FACTOR_LOWEST)
    errors.push(
      `The leak factor must be 0 (off) or at least ${LEAK_FACTOR_LOWEST}: under that, ordinary shots would read as leaks.`,
    );
  if (draft.empty_mm > 0 && draft.full_mm >= draft.empty_mm)
    errors.push(
      "The distance when full must be less than the distance when empty: the level sensor is above the water, so it reads further as the reservoir empties.",
    );
  for (const [n, doser] of Object.entries(draft.dosers))
    if (!inRange(doser.flow_ml_min, 1, 10000))
      errors.push(`Doser ${n}'s flow must be from 1 to 10000 mL/min.`);
  if (draft.recipes.length > maxRecipes) errors.push(`Up to ${maxRecipes} feed recipes.`);
  const names = new Set<string>();
  for (const recipe of draft.recipes) {
    const name = recipe.name.trim().replace(/\s+/g, " ");
    const label = name || "A feed recipe";
    if (!name) errors.push("Each feed recipe needs a name.");
    else if (name.length > NAME_LEN)
      errors.push(`${name.slice(0, 20)}…: a name is at most ${NAME_LEN} characters.`);
    else if (names.has(name.toLowerCase())) errors.push(`Two feed recipes are called ${name}.`);
    names.add(name.toLowerCase());
    if (!inRange(recipe.strength, 0, 20))
      errors.push(`${label}: the strength must be from 0 to 20 mL per litre per part.`);
    if (recipe.ec != null && !inRange(recipe.ec, ...FEED_EC))
      errors.push(
        `${label}: the feed EC must be from ${FEED_EC[0]} to ${FEED_EC[1]} mS/cm, or left empty.`,
      );
    for (const [n, dose] of Object.entries(recipe.doses)) {
      if (!inRange(dose.parts, 0, 100))
        errors.push(`${label}: doser ${n}'s parts must be from 0 to 100.`);
      else if (dose.parts > 0 && !dose.label.trim())
        errors.push(`${label}: doser ${n} has parts but no nutrient.`);
      if (dose.label.trim().length > NAME_LEN)
        errors.push(`${label}: doser ${n}'s nutrient is longer than ${NAME_LEN} characters.`);
    }
    const total = perLitre(recipe);
    if (Number.isFinite(total) && total > MAX_ML_PER_L)
      errors.push(
        `${label} comes to ${total.toFixed(1)} mL per litre; more than ${MAX_ML_PER_L} is refused as a likely typo in its strength or parts.`,
      );
  }
  const ids = new Set(draft.recipes.map((recipe) => recipe.id));
  const weeks = draft.schedule?.weeks ?? [];
  if (weeks.length > MAX_WEEKS) errors.push(`A feed schedule has at most ${MAX_WEEKS} weeks.`);
  const gone = weeks.flatMap((id, i) => (ids.has(id) ? [] : [i + 1]));
  if (gone.length)
    errors.push(
      `Week${gone.length === 1 ? "" : "s"} ${gone.join(", ")} of the feed schedule ${gone.length === 1 ? "uses" : "use"} a recipe that is removed: choose another.`,
    );
  if (draft.schedule?.start && !/^\d{4}-\d{2}-\d{2}$/.test(draft.schedule.start))
    errors.push("The day Week 1 starts on must be a date.");
  return errors;
}

/** A new recipe: no parts, with the nutrients the last recipe had on each doser, since the bottles on
 * the dosers usually stay where they are between stages. */
export function newRecipe(draft: FeedDraft, mapped: number[], name = ""): FeedRecipe {
  const last = draft.recipes[draft.recipes.length - 1];
  return {
    // Its own id at once, so it can be the stage in use in the same save (feed.py keeps a valid id).
    id: createUuid().replaceAll("-", "").slice(0, 12),
    name,
    strength: last?.strength ?? 1,
    doses: Object.fromEntries(
      mapped.map((n) => [String(n), { label: last?.doses[String(n)]?.label ?? "", parts: 0 }]),
    ),
    order: [...(last?.order ?? draft.order)],
    // Each recipe mixes to its own EC: measured once it is mixed, so none yet.
    ec: null,
  };
}

/** What feed_save takes: names and nutrients as feed.py keeps them. */
export const documentOf = (draft: FeedDraft) => ({
  ...draft,
  recipes: draft.recipes.map((recipe) => ({
    ...recipe,
    name: recipe.name.trim().replace(/\s+/g, " "),
    doses: Object.fromEntries(
      Object.entries(recipe.doses).map(([n, dose]) => [
        n,
        { label: dose.label.trim().replace(/\s+/g, " "), parts: dose.parts },
      ]),
    ),
  })),
});

/** "10 min", "1 min 30 s", "45 s". */
export function duration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const whole = Math.round(seconds);
  if (whole < 60) return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
  const minutes = Math.floor(whole / 60),
    rest = whole % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}
