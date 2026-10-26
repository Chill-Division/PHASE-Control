import type { Room, States } from "./types";
import { descriptor } from "./model";
import { RESERVOIR_KEYS, canRefill, levelPct, reminderPct } from "./feed";
import { STEP_LABELS, distanceMm, levelMm, readBatchStatus } from "./feed-status";

export interface TankReading {
  entityId: string | null;
  value: number | null;
  unit: string;
  issue: string | null;
}

/** What the tank card charts: the reservoir's distance sensor, and its distances when full and when
 * empty, so a recorded reading becomes % full as the controller works it out. */
export interface LevelSource {
  entityId: string;
  distance: { unit: string; fullMm: number; emptyMm: number };
  /** The least the controller keeps, %; null without one. */
  minPct: number | null;
  /** While nothing refills it by itself, the level a person is reminded to refill it by hand at, %
   * (reminderPct); null where no reminder comes. */
  remindPct: number | null;
  /** The controller refills it by itself: it has what a refill needs, and automatic refills are on. */
  selfRefilling: boolean;
}

/** The refills the controller runs for the room's reservoir, as it records them. */
export interface RefillRecord {
  /** What its refill is doing now: "Not running", "Filling", "Dosing"…; null before it reports. */
  now: string | null;
  running: boolean;
  /** When its last refill ended (ISO); null before the first. */
  lastAt: string | null;
  /** That refill stopped part-way. */
  lastStopped: boolean;
  issue: string | null;
}

export function tankTelemetry(states: States, room: Room) {
  const config = descriptor(states, room)?.attributes || {};
  const mapped = (key: string) =>
    typeof config[key] === "string" && config[key] ? String(config[key]) : null;
  const binary = (key: string) => {
    const entityId = mapped(key),
      state = entityId ? states[entityId]?.state : undefined;
    return {
      entityId,
      on: state === "on" ? true : state === "off" ? false : null,
      issue: !entityId ? "Not mapped" : !["on", "off"].includes(state || "") ? "Unavailable" : null,
    };
  };
  // The reservoir's level, once its distances when full and when empty are set (Feed → Reservoir):
  // the controller's, once it reports one, so the card shows what it acts on (none when the sensor
  // reads nothing to it, whatever that shows now); before that, the distance sensor's reading worked
  // out the same way.
  const plan = states[`sensor.crop_steering_${room.prefix}feed_plan`]?.attributes;
  const distanceId = mapped("reservoir_distance_sensor");
  const full = Number(plan?.full_mm),
    empty = Number(plan?.empty_mm);
  const own = distanceId && full > 0 && full < empty;
  const status = readBatchStatus(states, room.prefix);
  const pct = !own
    ? null
    : status
      ? status.levelPct
      : levelPct(levelMm(states[distanceId]), full, empty);
  const level: TankReading = {
    entityId: distanceId,
    value: pct === null ? null : Math.round(pct * 10) / 10,
    unit: "%",
    issue: !distanceId ? "Not mapped" : !own ? "Not set up" : pct === null ? "Unavailable" : null,
  };
  // A room with a reservoir: the controller's record of the refills it runs (batch_status). None for
  // a room without one, which nothing refills.
  const step = status?.step ?? null;
  const refill: RefillRecord | null =
    status || RESERVOIR_KEYS.some((key) => mapped(key))
      ? {
          now: step === null ? null : step === "idle" ? "Not running" : STEP_LABELS[step],
          running: step !== null && step !== "idle",
          lastAt: status?.last?.at ? new Date(status.last.at).toISOString() : null,
          lastStopped: !!status?.last && status.last.result !== "done",
          issue: step === null ? "Unavailable" : null,
        }
      : null;
  const minPct = status?.minPct ?? Number(plan?.min_pct);
  const auto = states[`switch.crop_steering_${room.prefix}auto_batches`]?.state;
  const remindPct = reminderPct(
    plan?.remind_pct,
    minPct > 0 ? minPct : 0,
    auto === "on" ? true : auto === "off" ? false : null,
    canRefill(config),
  );
  const source: LevelSource | null =
    own && distanceId
      ? {
          entityId: distanceId,
          distance: {
            unit: String(states[distanceId]?.attributes.unit_of_measurement ?? ""),
            fullMm: full,
            emptyMm: empty,
          },
          minPct: minPct > 0 ? minPct : null,
          remindPct,
          selfRefilling: canRefill(config) && auto === "on",
        }
      : null;
  return {
    level,
    pump: binary("pump"),
    refill,
    source,
  };
}

/** How many steps the level chart's window is drawn in: 10 minutes each over 24 hours. */
export const LEVEL_STEPS = 144;

/** About how wide a time on the level chart's axis is drawn (12 px), in px. */
const timeWidth = (text: string) => text.length * 6.5;
/** Whether the level chart's middle time fits on an axis `width` px wide, a little apart from the
 * window's start on its left and Now on its right: a narrow chart (the Overview's side column on a
 * wide screen) leaves it out rather than run the times together. */
export function middleTimeFits(width: number, start: string, middle: string, end: string): boolean {
  const half = width / 2,
    gap = 8;
  return (
    timeWidth(start) + timeWidth(middle) / 2 + gap <= half &&
    timeWidth(middle) / 2 + gap + timeWidth(end) <= half
  );
}

/** The reservoir's recorded readings as % full over the last `hours`, in LEVEL_STEPS steps: each step
 * the middle reading recorded in it, or with none the level it held (Home Assistant records a change,
 * not a level that holds still). It ends on `current`, the level the card shows now. */
/** A level sensor's recorded readings as % full, oldest first, worked out as the controller does. */
export function levelReadings(
  points: { time: string; value: number }[],
  source: LevelSource,
): { at: number; pct: number }[] {
  const { distance } = source;
  const pctOf = (value: number) =>
    levelPct(distanceMm(value, distance.unit), distance.fullMm, distance.emptyMm);
  return points
    .map((point) => ({ at: Date.parse(point.time), pct: pctOf(point.value) }))
    .filter((r): r is { at: number; pct: number } => Number.isFinite(r.at) && r.pct !== null)
    .sort((a, b) => a.at - b.at);
}

export function levelSeries(
  points: { time: string; value: number }[],
  source: LevelSource,
  hours: number,
  current: number | null,
  now = Date.now(),
): { at: number; pct: number | null }[] {
  const readings = levelReadings(points, source);
  const tenth = (pct: number | null) => (pct === null ? null : Math.round(pct * 10) / 10);
  const start = now - hours * 3_600_000,
    step = (now - start) / LEVEL_STEPS;
  let held: number | null = null,
    next = 0;
  for (; next < readings.length && readings[next].at < start; next++) held = readings[next].pct;
  const series: { at: number; pct: number | null }[] = [];
  for (let n = 0; n < LEVEL_STEPS; n++) {
    const from = start + n * step,
      within: number[] = [];
    for (; next < readings.length && readings[next].at < from + step; next++)
      within.push(readings[next].pct);
    if (within.length) held = within[within.length - 1];
    const middle = [...within].sort((a, b) => a - b)[Math.floor(within.length / 2)];
    series.push({ at: from, pct: tenth(within.length ? middle : held) });
  }
  series.push({ at: now, pct: tenth(current ?? held) });
  return series;
}
