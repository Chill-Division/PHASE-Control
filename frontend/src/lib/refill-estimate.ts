/** When a reservoir is expected to reach a level: its minimum (where it refills, or where watering
 * waits for a refill by hand), or the level a reminder to refill comes at.
 *
 * Owner, 2026-10-26: "how many days until it needs refilling … an 80 L reservoir feeding 4 plants
 * will last 5-7 days, a 140 L one feeding 90 maybe half a day". The tank's own recorded level says
 * how fast it goes, whatever its size and whatever draws on it: the last 24 hours, as quarter-hour
 * medians, with the rise of any refill left out. Played forward from now in the same daily pattern
 * (most of a room's water goes in its morning ramp), it says when the level gets there. */

const DAY_MS = 86_400_000;
const STEP_MS = 15 * 60_000;
const STEPS = DAY_MS / STEP_MS;
/** A rise this big from one quarter-hour to the next is a refill, by hand or not: not use. */
const REFILL_RISE_PCT = 3;
/** The recorded level must reach back at least this far into the last day. */
const LEAST_HISTORY_MS = 20 * 3_600_000;
/** A day's use under this, % of the reservoir, is too little to estimate from. */
const LEAST_USE_PCT = 0.5;
/** No estimate reaches past this: it says "more than 30 days". */
export const LONGEST_MS = 30 * DAY_MS;

export interface RefillEstimate {
  /** When the level gets there: `now` if it already has, Infinity past LONGEST_MS, null when it
   * can't be told (then `reason` says why). */
  at: number | null;
  /** How much of the reservoir the last day used, %, refills left out. */
  perDay: number | null;
  reason: string | null;
}

/** When the level reaches `threshold` %, from `readings` (the level's recorded history in %, any
 * order) and the level now. */
export function refillEstimate(
  readings: { at: number; pct: number }[],
  current: number | null,
  threshold: number,
  now: number,
): RefillEstimate {
  if (current === null) return { at: null, perDay: null, reason: "The level reads nothing." };
  const start = now - DAY_MS;
  const day = readings.filter((r) => r.at >= start && r.at <= now).sort((a, b) => a.at - b.at);
  if (!day.length || day[0].at > now - LEAST_HISTORY_MS)
    return { at: null, perDay: null, reason: "It needs about a day of recorded level first." };
  // Each quarter-hour of the last day: what it used, the fall from the last median before it (for
  // the first, from the last reading before the day, when there is one).
  const used: number[] = [];
  let last: number | null =
    readings.filter((r) => r.at < start).sort((a, b) => b.at - a.at)[0]?.pct ?? null;
  for (let n = 0, i = 0; n < STEPS; n++) {
    const end = start + (n + 1) * STEP_MS,
      within: number[] = [];
    for (; i < day.length && day[i].at < end; i++) within.push(day[i].pct);
    within.sort((a, b) => a - b);
    const median = within.length ? within[Math.floor(within.length / 2)] : null;
    const fall = median === null || last === null ? 0 : last - median;
    used.push(fall < -REFILL_RISE_PCT ? 0 : fall);
    if (median !== null) last = median;
  }
  const perDay = used.reduce((sum, fall) => sum + fall, 0);
  if (perDay < LEAST_USE_PCT)
    return { at: null, perDay, reason: "It has hardly been used in the last day." };
  if (current <= threshold) return { at: now, perDay, reason: null };
  // Forward from now, a day being like the last one: the next quarter-hour uses what the same
  // quarter-hour of yesterday did.
  let level = current;
  for (let n = 0; n * STEP_MS < LONGEST_MS; n++) {
    const fall = used[n % STEPS];
    if (fall > 0 && level - fall <= threshold)
      return { at: now + (n + (level - threshold) / fall) * STEP_MS, perDay, reason: null };
    level -= fall;
  }
  return { at: Infinity, perDay, reason: null };
}

/** "today, around 4:00 pm", "tomorrow, around 9:00 am", "Thu, around 9:00 am", "Mon 3 Nov", in the
 * browser's own words for days and times. */
export function refillByWords(at: number, now: number): string {
  if (at === Infinity) return "more than 30 days away";
  const hour = new Date(Math.round(at / 3_600_000) * 3_600_000);
  const time = hour.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = Math.round(
    (new Date(at).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY_MS,
  );
  if (days <= 0) return at - now < 60 * 60_000 ? "now" : `today, around ${time}`;
  if (days === 1) return `tomorrow, around ${time}`;
  if (days < 7)
    return `${new Date(at).toLocaleDateString([], { weekday: "short" })}, around ${time}`;
  return new Date(at).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

/** "in about 7 hours", "in about 1½ days", "in about 5 days". */
export function inAbout(ms: number): string {
  if (ms === Infinity) return "in more than 30 days";
  const hours = ms / 3_600_000;
  if (hours < 1) return "within the hour";
  if (hours < 20) return `in about ${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"}`;
  const days = hours / 24;
  if (days < 3) {
    const halves = Math.round(days * 2) / 2;
    const whole = Math.floor(halves);
    return `in about ${whole || ""}${halves % 1 ? "½" : ""} day${halves > 1 ? "s" : ""}`;
  }
  return `in about ${Math.round(days)} days`;
}
