import type { DayTrace, GrowDay, Reading, Shot } from "./day-timeline";

/** One grow-day of a zone's week, lights-on to lights-on, as Insights › Zone draws and reads it. */
export interface WeekDay {
  day: GrowDay;
  today: boolean;
  /** VWC by hours since that day's lights-on. */
  points: { hour: number; value: number }[];
  shots: number;
  /** The highest reading while the lights were on, and when. */
  peak: { value: number; hour: number } | null;
  /** How far it dried from that peak by the next lights-on, as a percentage of the peak: what the P3
   * dryback target reads. Null for today, and for a day whose end was not recorded. */
  dryback: number | null;
}

const hourOf = (day: GrowDay, time: number) => (time - day.start) / 3_600_000;

/** VWC at `hour`, read between the readings either side; past the last (or before the first), the
 * nearest one within `near` hours. */
function valueAt(points: { hour: number; value: number }[], hour: number, near: number) {
  let before: (typeof points)[number] | undefined, after: (typeof points)[number] | undefined;
  for (const point of points) {
    if (point.hour <= hour) before = point;
    else {
      after = point;
      break;
    }
  }
  if (before && after)
    return (
      before.value +
      ((after.value - before.value) * (hour - before.hour)) / (after.hour - before.hour)
    );
  const nearest = [before, after].find((point) => point && Math.abs(point.hour - hour) <= near);
  return nearest ? nearest.value : null;
}

function readDay(
  day: GrowDay,
  points: { hour: number; value: number }[],
  shots: number,
  today: boolean,
): WeekDay {
  const photoperiod = hourOf(day, day.lightsOff);
  let peak: WeekDay["peak"] = null;
  for (const point of points)
    if (point.hour <= photoperiod && (!peak || point.value > peak.value))
      peak = { value: point.value, hour: point.hour };
  // The reading at the next lights-on: the last within half an hour of the day's end.
  const end = today ? null : valueAt(points, hourOf(day, day.end), 0.5);
  const dryback =
    peak && end !== null && peak.value > 0 ? ((peak.value - end) / peak.value) * 100 : null;
  return { day, today, points, shots, peak, dryback };
}

/** The zone's week, oldest first: each earlier grow-day recorded (null ones left out), then today so
 * far. */
export function weekDays(
  today: { day: GrowDay; points: Reading[]; shots: Shot[] } | null,
  traces: readonly (DayTrace | null)[],
): WeekDay[] {
  const earlier = traces
    .filter((trace): trace is DayTrace => trace !== null)
    .map((trace) =>
      readDay(
        trace.day,
        trace.points.map((point) => ({ hour: point.hour, value: point.value })),
        trace.shots.length,
        false,
      ),
    )
    .reverse();
  if (!today) return earlier;
  return [
    ...earlier,
    readDay(
      today.day,
      today.points.map((point) => ({ hour: hourOf(today.day, point.time), value: point.value })),
      today.shots.length,
      true,
    ),
  ];
}

export interface Finding {
  tone: "good" | "warn" | "info";
  text: string;
}
const clockAt = (day: GrowDay, hour: number) =>
  new Date(day.start + hour * 3_600_000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
const dayName = (day: GrowDay) =>
  new Date(day.start).toLocaleDateString([], { weekday: "short", day: "numeric" });
const round = (value: number) => Math.round(value);

/** What a zone's week says, in a few plain sentences: its overnight dryback against its target, when
 * the peak came, and how many shots a day it took. Only what the readings show; nothing is said
 * about a day that was not recorded. */
export function weekFindings(days: WeekDay[], drybackTarget: number | null): Finding[] {
  const findings: Finding[] = [];
  const complete = days.filter((day) => !day.today);
  const drybacks = complete.flatMap((day) => (day.dryback === null ? [] : [day.dryback]));
  if (drybacks.length) {
    const average = drybacks.reduce((sum, value) => sum + value, 0) / drybacks.length;
    const span = `over the last ${drybacks.length} grow-${drybacks.length === 1 ? "day" : "days"}`;
    if (drybackTarget === null)
      findings.push({
        tone: "info",
        text: `Overnight dryback averaged ${round(average)}% ${span}.`,
      });
    else {
      const off = average - drybackTarget;
      findings.push({
        tone: Math.abs(off) <= 3 ? "good" : "warn",
        text:
          Math.abs(off) <= 1
            ? `Overnight dryback averaged ${round(average)}% ${span}, on its ${round(drybackTarget)}% target.`
            : Math.abs(off) <= 3
              ? `Overnight dryback averaged ${round(average)}% ${span}, just ${off < 0 ? "under" : "over"} its ${round(drybackTarget)}% target.`
              : `Overnight dryback averaged ${round(average)}% ${span}, ${round(Math.abs(off))} points ${off < 0 ? "short of" : "past"} its ${round(drybackTarget)}% target.`,
      });
    }
  }
  const peaks = complete.filter((day) => day.peak);
  if (peaks.length >= 2) {
    const first = peaks[0],
      last = peaks.at(-1)!;
    const minutes = round((last.peak!.hour - first.peak!.hour) * 60);
    findings.push(
      Math.abs(minutes) < 30
        ? {
            tone: "good",
            text: `The peak came at much the same time each day: ${clockAt(first.day, first.peak!.hour)} on ${dayName(first.day)}, ${clockAt(last.day, last.peak!.hour)} on ${dayName(last.day)}.`,
          }
        : {
            tone: minutes > 0 ? "warn" : "info",
            text: `The peak came ${Math.abs(minutes)} minutes ${minutes > 0 ? "later" : "sooner"} by the end of the week: ${clockAt(first.day, first.peak!.hour)} on ${dayName(first.day)}, ${clockAt(last.day, last.peak!.hour)} on ${dayName(last.day)}${minutes > 0 ? ". The ramp-up is taking longer to bring the substrate up" : ""}.`,
          },
    );
  }
  const shots = complete.map((day) => day.shots);
  if (shots.length) {
    const low = Math.min(...shots),
      high = Math.max(...shots);
    const average = shots.reduce((sum, value) => sum + value, 0) / shots.length;
    findings.push({
      tone: "info",
      text:
        low === high
          ? `${low} ${low === 1 ? "shot" : "shots"} a day.`
          : `${low} to ${high} shots a day, ${round(average)} on average.`,
    });
  }
  return findings;
}
