import { doserOrder, type FeedRecipe, type PlannedDose } from "./feed";
import type { EntityState, States } from "./types";

/** A room's nutrient batch as the controller app reports it: sensor.crop_steering_<prefix>batch_status
 * (controller.py _batch_publish). The state is the step; idle while no batch runs. */
// "settling" is an older controller's step (circulating before the first dose).
export const BATCH_STEPS = [
  "filling",
  "filling_mixing",
  "dosing",
  "pausing",
  "mixing",
  "settling",
] as const;
export type BatchStep = "idle" | (typeof BATCH_STEPS)[number];
export interface BatchDose extends PlannedDose {
  /** mL it gave in the batch running now; null before its turn. */
  dosed: number | null;
}
/** A dose of the last batch, as the controller recorded it. */
export interface LastDose {
  doser: number;
  /** Its nutrient; "" when the recipe named none. */
  label: string;
  /** What the recipe asked for, mL. */
  ml: number;
  /** What it gave, mL; null when the batch stopped before its turn. */
  given: number | null;
}
export interface LastBatch {
  at: number | null;
  /** "done", or "stopped: <why>". */
  result: string;
  stage: string | null;
  dosed: Record<string, number>;
  /** Each dose in the order it went in; null from an older controller, which kept only `dosed`. */
  doses: LastDose[] | null;
}
export interface BatchStatus {
  entityId: string;
  /** null: the sensor reads something else (unavailable). */
  step: BatchStep | null;
  stage: string | null;
  /** When the step in progress ends (epoch ms). */
  until: number | null;
  /** When the fresh water stops (epoch ms), the doses going in before then; null once it has, and from
   * an older controller, which stopped it before the first dose. */
  fillUntil: number | null;
  doser: number | null;
  nutrient: string | null;
  doses: BatchDose[];
  levelMm: number | null;
  /** How full the reservoir is, %, as the controller works it out; null without a level. */
  levelPct: number | null;
  fullMm: number | null;
  emptyMm: number | null;
  /** The least it keeps, %. */
  minPct: number | null;
  /** What 1% of the reservoir holds, learned from refills; null until one has gone all the way. */
  litresPerPct: number | null;
  /** Would the room's next round of shots take it under its minimum; null when it can't tell. */
  due: boolean | null;
  /** The litres that round takes. */
  nextRoundL: number | null;
  auto: boolean;
  armed: boolean;
  last: LastBatch | null;
  /** Why no batch could start now, or null. */
  blocked: string | null;
  /** Watering waits for the reservoir with nothing to refill it by itself: why, and why it can't
   * refill. Null when it doesn't, and from an older controller, which didn't say. */
  wateringHeld: { why: string; cannot: string } | null;
  updated: number | null;
}

export const STEP_LABELS: Record<BatchStep, string> = {
  idle: "Idle",
  filling: "Filling",
  filling_mixing: "Filling and mixing",
  settling: "Mixing",
  dosing: "Dosing",
  pausing: "Between dosers",
  mixing: "Mixing",
};

const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const text = (value: unknown) => (typeof value === "string" && value ? value : null);
const held = (value: unknown) => {
  const item = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const why = text(item?.why),
    cannot = text(item?.cannot);
  return why && cannot ? { why, cannot } : null;
};
const time = (value: unknown) => {
  const at = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : null;
};

export const batchStatusId = (prefix: string) => `sensor.crop_steering_${prefix}batch_status`;

/** The room's batch status, or null when the controller has not reported one (no reservoir mapped,
 * the controller app not running, or a version without nutrient batches). */
export function readBatchStatus(states: States, prefix: string): BatchStatus | null {
  const entityId = batchStatusId(prefix);
  const entity = states[entityId];
  if (!entity) return null;
  const a = entity.attributes;
  const step = (["idle", ...BATCH_STEPS] as string[]).includes(entity.state)
    ? (entity.state as BatchStep)
    : null;
  const last = a.last && typeof a.last === "object" ? (a.last as Record<string, unknown>) : null;
  return {
    entityId,
    step,
    stage: text(a.stage),
    until: time(a.until),
    fillUntil: time(a.fill_until),
    doser: finite(a.doser),
    nutrient: text(a.nutrient),
    doses: Array.isArray(a.doses)
      ? a.doses.flatMap((dose) => {
          const d = dose as Record<string, unknown>;
          const doser = finite(d.doser);
          return doser === null
            ? []
            : [
                {
                  doser,
                  label: text(d.label) ?? `Doser ${doser}`,
                  ml: finite(d.ml) ?? 0,
                  seconds: finite(d.seconds) ?? 0,
                  dosed: finite(d.dosed),
                },
              ];
        })
      : [],
    levelMm: finite(a.level_mm),
    levelPct: finite(a.level_pct),
    fullMm: finite(a.full_mm),
    emptyMm: finite(a.empty_mm),
    minPct: finite(a.min_pct),
    litresPerPct: finite(a.litres_per_pct),
    due: typeof a.due === "boolean" ? a.due : null,
    nextRoundL: finite(a.next_round_l),
    auto: a.auto === true,
    armed: a.armed !== false,
    last: last
      ? {
          at: time(last.at),
          result: text(last.result) ?? "unknown",
          stage: text(last.stage),
          dosed:
            last.dosed && typeof last.dosed === "object"
              ? Object.fromEntries(
                  Object.entries(last.dosed as Record<string, unknown>).flatMap(([n, ml]) =>
                    finite(ml) === null ? [] : [[n, finite(ml)!]],
                  ),
                )
              : {},
          doses: Array.isArray(last.doses)
            ? (last.doses as unknown[]).flatMap((item) => {
                const dose = (item && typeof item === "object" ? item : {}) as Record<
                  string,
                  unknown
                >;
                const doser = finite(dose.doser),
                  ml = finite(dose.ml);
                return doser === null || ml === null
                  ? []
                  : [{ doser, label: text(dose.label) ?? "", ml, given: finite(dose.given) }];
              })
            : null,
        }
      : null,
    blocked: text(a.blocked),
    wateringHeld: held(a.watering_held),
    updated: time(a.updated),
  };
}

/** A distance sensor's reading in mm, as the controller reads it (controller.py level_mm): it may
 * report mm, cm or m; no unit is mm. null when it reads no number or another unit. */
export function levelMm(entity: EntityState | undefined): number | null {
  if (!entity || !entity.state.trim()) return null;
  return distanceMm(Number(entity.state), entity.attributes.unit_of_measurement);
}

/** A distance in mm from a reading in mm, cm or m (no unit is mm); null for another unit. */
export function distanceMm(value: number, unit: unknown): number | null {
  const factor = ({ mm: 1, cm: 10, m: 1000, "": 1 } as Record<string, number>)[
    String(unit ?? "")
      .trim()
      .toLowerCase()
  ];
  return Number.isFinite(value) && factor !== undefined ? value * factor : null;
}

/** Before a refill asked for by hand: why the controller would refuse it as one that could overflow
 * the reservoir (controller.py _fill_overflow), or null. `pct` is how full it reads (null without a
 * level), `levelSetUp` whether its level sensor and both distances are set, `litresPerPct` what 1%
 * holds once a refill has shown it. Before that, one starts only from 10% (or the minimum, if
 * higher) so the fill cannot overflow. */
export function fillRefusal(
  pct: number | null,
  levelSetUp: boolean,
  fillLitres: number,
  minPct: number,
  litresPerPct: number | null,
): string | null {
  if (pct === null)
    return levelSetUp ? "The level sensor has no reading, so a fill could overflow it." : null;
  if (litresPerPct) {
    const rise = fillLitres / litresPerPct;
    return pct + rise > 100
      ? `The reservoir reads ${Math.round(pct)}%, and its ${fillLitres} L fill adds about ${Math.round(rise)}%, so it could overflow.`
      : null;
  }
  const from = Math.max(10, minPct || 0);
  return pct > from
    ? `The reservoir reads ${Math.round(pct)}%: until a refill has shown how far its ${fillLitres} L fill raises it, a refill asked for by hand starts only from ${from}% or less.`
    : null;
}

/** "3 min 20 s left", counted to `until`; null once it has passed or when unknown. */
export function timeLeft(until: number | null, now = Date.now()): string | null {
  if (until === null) return null;
  const seconds = Math.ceil((until - now) / 1000);
  if (seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60),
    rest = seconds % 60;
  return minutes ? `${minutes} min${rest ? ` ${rest} s` : ""} left` : `${rest} s left`;
}

/** The last batch's doses in words, in the order they went in: "Balance 252 mL · Bloom 600 of
 * 1,200 mL · Core and Cleanse not dosed". An older controller's record kept only each doser's
 * number and what it gave: the recipe of the stage it mixed, while it is still here, names them, in
 * its dosing order. */
export function lastBatchWords(last: LastBatch, recipes: FeedRecipe[] = []): string {
  const mL = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (!last.doses) {
    const recipe = recipes.find((item) => item.name === last.stage);
    const dosers = Object.keys(last.dosed).map(Number);
    return (
      (recipe ? doserOrder(recipe.order, dosers) : dosers)
        .map((doser) => {
          const label = recipe?.doses[String(doser)]?.label || `doser ${doser}`;
          return `${label} ${mL(last.dosed[String(doser)])} mL`;
        })
        .join(" · ") || "Nothing dosed"
    );
  }
  const name = (dose: LastDose) => dose.label || `doser ${dose.doser}`;
  const list = (items: string[]) =>
    items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
  const given = last.doses.flatMap((dose) =>
    dose.given === null
      ? []
      : [
          Math.round(dose.given) < Math.round(dose.ml)
            ? `${name(dose)} ${mL(dose.given)} of ${mL(dose.ml)} mL`
            : `${name(dose)} ${mL(dose.ml)} mL`,
        ],
  );
  const missed = last.doses.filter((dose) => dose.given === null).map(name);
  return (
    [...given, ...(missed.length ? [`${list(missed)} not dosed`] : [])].join(" · ") ||
    "Nothing dosed"
  );
}
