import type { EntityState } from "./types";

/** One condition that would move a zone next, as the controller publishes it on
 * sensor.crop_steering_<prefix>zone_N_waiting_for_app (crop_steering_engine.waiting_for): decide()'s
 * own threshold and the reading it compares, or how long a wait has left. */
export interface WaitingCondition {
  rule: string;
  shot: boolean;
  to: string | null;
  metric?: "vwc" | "ec";
  op?: "<" | "<=" | ">" | ">=";
  value?: number;
  now?: number | null;
  in_min?: number;
  shots_left?: number;
  ec_max?: number | null;
  ec_now?: number | null;
  /** p3_hold: the P3 dryback target its level is worked out from, % of the day's peak. */
  dryback?: number;
  /** p3_hold: that peak, the day's highest reading. */
  peak?: number;
}
export interface Waiting {
  /** When the controller worked it out: a wait ends `in_min` after this. */
  at: number;
  conditions: WaitingCondition[];
}

/** A controller that stopped publishing has moved on without saying so: show nothing, not a stale
 * condition, once it is this old. */
const FRESH_MS = 5 * 60_000;

const isCondition = (item: unknown): item is WaitingCondition =>
  !!item && typeof item === "object" && typeof (item as { rule?: unknown }).rule === "string";

/** The controller's conditions for `phase`, the phase shown beside them (its sensor's state is the
 * phase they were worked out for): null when they are for another one, or not fresh. */
export function readWaiting(
  entity: EntityState | undefined,
  now = Date.now(),
  phase?: string,
): Waiting | null {
  if (!entity || (phase !== undefined && entity.state !== phase)) return null;
  const at = Date.parse(String(entity.attributes.at ?? ""));
  if (!Number.isFinite(at) || at > now + 60_000 || now - at > FRESH_MS) return null;
  const conditions = entity.attributes.conditions;
  if (!Array.isArray(conditions)) return null;
  const valid = conditions.filter(isCondition);
  return valid.length ? { at, conditions: valid } : null;
}

export interface WaitingFormat {
  number: (value: number) => string;
  clock: (time: number) => string;
  /** The dashboard's own estimate of the next maintenance shot, from the dry-down rate. */
  shotEstimate?: number | null;
}

const SIGN: Record<string, string> = { "<": "<", "<=": "≤", ">": ">", ">=": "≥" };
const plural = (count: number, word: string) => `${count} more ${word}${count === 1 ? "" : "s"}`;

/** What the zone is waiting for, in one line: the controller's thresholds and the reading now. */
export function waitingText(waiting: Waiting, format: WaitingFormat): string {
  const { number: n, clock } = format;
  const find = (rule: string) => waiting.conditions.find((item) => item.rule === rule);
  const when = (item: WaitingCondition) =>
    item.in_min ? clock(waiting.at + item.in_min * 60_000) : null;
  const test = (item: WaitingCondition, unit: string, label: string) =>
    `${label} ${SIGN[item.op ?? ""] ?? item.op} ${n(item.value ?? NaN)}${unit}`;
  const now = (item: WaitingCondition, unit: string) =>
    item.now === null || item.now === undefined ? "" : `now ${n(item.now)}${unit}`;

  const timeout = find("p0_timeout");
  if (timeout) {
    // Whichever moisture level drying reaches first: the trigger, or the P3 dryback's level.
    const levels = [find("p0_bypass"), find("p0_dryback")].filter(
      (item): item is WaitingCondition => item?.value !== undefined,
    );
    const first = levels.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
    const at = when(timeout);
    return `P1 ${at ? `by ${at}` : "now"}${first ? `, or sooner at ${test(first, "%", "VWC")} (${now(first, "%")})` : ""}`;
  }

  const done = find("p1_done");
  if (done) {
    const ramp = find("p1_ramp");
    const parts: string[] = [];
    if (ramp) {
      const below = ramp.now !== null && ramp.now !== undefined && ramp.now < (ramp.value ?? 0);
      const at = when(ramp);
      parts.push(
        below
          ? `ramp shot ${at ? `at ${at}` : "due"} (VWC ${n(ramp.now ?? NaN)}% under ${n(ramp.value ?? NaN)}%)`
          : `ramp shot when ${test(ramp, "%", "VWC")} (${now(ramp, "%")})`,
      );
    }
    const shots = done.shots_left ? ` after ${plural(done.shots_left, "shot")}` : "";
    const ec =
      done.ec_max === null || done.ec_max === undefined
        ? ""
        : ` with pwEC ≤ ${n(done.ec_max)}${done.ec_now === null || done.ec_now === undefined ? "" : ` (now ${n(done.ec_now)})`}`;
    const most = find("p1_max_shots")?.shots_left;
    parts.push(
      `P2 at ${test(done, "%", "VWC")}${shots}${ec}${most ? `, or after ${plural(most, "ramp shot")}` : ""}`,
    );
    return parts.join(" · ");
  }

  const topup = find("p2_topup");
  const off = find("lights_off");
  if (topup || off) {
    // A held plan leaves the routine shots out: then only lights-off is left.
    const estimate =
      format.shotEstimate === null || format.shotEstimate === undefined
        ? ""
        : `, ≈ ${clock(format.shotEstimate)} at this dry-down`;
    const dilute = find("p2_dilute");
    // Under the trigger, a maintenance shot may still wait out the time between P2 shots.
    const wait = topup ? when(topup) : null;
    const below =
      wait !== null &&
      topup?.now !== null &&
      topup?.now !== undefined &&
      topup.now < (topup.value ?? 0);
    return [
      topup
        ? below
          ? `shot at ${wait} (VWC ${n(topup.now ?? NaN)}% under ${n(topup.value ?? NaN)}%)`
          : `shot when ${test(topup, "%", "VWC")} (${now(topup, "%")}${estimate})`
        : null,
      dilute ? `dilution if ${test(dilute, "", "pwEC")} (${now(dilute, "")})` : null,
      // By, not at: in its last three hours P2 moves early when the night is too short to dry back.
      off ? `P3 by ${when(off) ?? "lights-off"}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  const rescue = find("p3_emergency");
  let hold = find("p3_hold");
  // A rescue level at or over the dryback's end fires first, every time: then it is the only shot.
  if (rescue && hold && (hold.value ?? 0) <= (rescue.value ?? 0)) hold = undefined;
  if (rescue || hold) {
    const on = find("lights_on");
    // Under the dryback's end, a hold shot may still wait out the time between P3 shots.
    const wait = hold ? when(hold) : null;
    const below =
      wait !== null &&
      hold?.now !== null &&
      hold?.now !== undefined &&
      hold.now < (hold.value ?? 0);
    // So may a rescue, under the rescue level.
    const due = rescue ? when(rescue) : null;
    const rescuing =
      due !== null &&
      rescue?.now !== null &&
      rescue?.now !== undefined &&
      rescue.now < (rescue.value ?? 0);
    // Which dryback, from which peak: never a dryback from the reading beside it.
    const dryback =
      `the ${n(hold?.dryback ?? NaN)}% dryback` +
      (hold?.peak ? ` from the ${n(hold.peak)}% peak` : "");
    return [
      hold
        ? below
          ? `shot at ${wait} (VWC ${n(hold.now ?? NaN)}% under ${n(hold.value ?? NaN)}%, ${dryback})`
          : `shot when ${test(hold, "%", "VWC")} (${now(hold, "%")}), ${dryback}`
        : null,
      // The reading is said once: with the hold, beside it.
      rescue
        ? rescuing
          ? `rescue shot at ${due} (VWC ${n(rescue.now ?? NaN)}% under ${n(rescue.value ?? NaN)}%)`
          : `rescue shot if ${test(rescue, "%", "VWC")}${hold ? "" : ` (${now(rescue, "%")})`}`
        : null,
      on ? `P0 at ${when(on) ?? "lights-on"}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return "";
}
