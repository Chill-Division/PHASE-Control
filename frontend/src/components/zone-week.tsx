import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import { number, time as clock } from "@/components/dashboard";
import type { Finding, WeekDay } from "@/lib/zone-week";
import "./zone-week.css";

const TONE_ICON = { good: CircleCheck, warn: TriangleAlert, info: Info } as const;

/** What the readings show, a sentence a line, each with its tone. */
export function Findings({ title, findings }: { title: string; findings: Finding[] }) {
  return (
    <section className="card findings" aria-labelledby="findings-title" data-findings>
      <div className="card-head">
        <h2 id="findings-title">{title}</h2>
      </div>
      {findings.length ? (
        <ul>
          {findings.map((finding) => {
            const Icon = TONE_ICON[finding.tone];
            return (
              <li key={finding.text} data-tone={finding.tone}>
                <Icon size={18} aria-hidden="true" />
                <span>{finding.text}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">
          Nothing to say yet: a finding needs a few recorded grow-days, and these load from Home
          Assistant’s history.
        </p>
      )}
    </section>
  );
}

const dayLabel = (day: WeekDay) =>
  day.today
    ? "Today"
    : new Date(day.day.start).toLocaleDateString([], { weekday: "short", day: "numeric" });

/** The zone's week as small charts, one a grow-day: its moisture lights-on to lights-on, the night
 * shaded, its band from the maintenance trigger to the peak target. */
export function ZoneWeek({
  days,
  peakTarget,
  triggerTarget,
  color,
  name,
}: {
  days: WeekDay[];
  peakTarget: number | null;
  triggerTarget: number | null;
  color: string;
  name: string;
}) {
  const values = [
    ...days.flatMap((day) => day.points.map((point) => point.value)),
    ...[peakTarget, triggerTarget].filter((value): value is number => value !== null),
  ];
  const low = values.length ? Math.min(...values) : 40,
    high = values.length ? Math.max(...values) : 70;
  const pad = Math.max(1, (high - low) * 0.08);
  const W = 120,
    H = 70;
  const y = (value: number) =>
    H - 3 - ((value - (low - pad)) / (high - low + 2 * pad || 1)) * (H - 6);
  const band =
    peakTarget !== null && triggerTarget !== null && peakTarget > triggerTarget
      ? { top: y(peakTarget), bottom: y(triggerTarget) }
      : null;
  return (
    <section className="zone-week" aria-labelledby="zone-week-title">
      <div className="zone-week-head">
        <h2 id="zone-week-title">The week, day by day</h2>
        <span>Lights-on to lights-on · shaded: the band from trigger to peak</span>
      </div>
      {days.length ? (
        <ol className="zone-week-days">
          {days.map((day) => {
            const length = (day.day.end - day.day.start) / 3_600_000;
            const x = (hour: number) => (hour / length) * W;
            const off = x((day.day.lightsOff - day.day.start) / 3_600_000);
            const path = day.points
              .map(
                (point, i) =>
                  `${i ? "L" : "M"}${x(point.hour).toFixed(1)} ${y(point.value).toFixed(1)}`,
              )
              .join("");
            const label = `${name}, ${dayLabel(day)}: ${
              day.peak
                ? `peak ${number(day.peak.value)}% at ${clock(day.day.start + day.peak.hour * 3_600_000)}`
                : "no peak recorded"
            }${day.dryback === null ? "" : `, dried back ${number(day.dryback, 0)}% overnight`}, ${day.shots} ${day.shots === 1 ? "shot" : "shots"}`;
            return (
              <li key={day.day.start} data-today={day.today || undefined}>
                <strong>{dayLabel(day)}</strong>
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={label}
                >
                  <rect
                    x={off}
                    y={0}
                    width={Math.max(0, W - off)}
                    height={H}
                    className="mini-night"
                  />
                  {band && (
                    <rect
                      x={0}
                      y={band.top}
                      width={W}
                      height={Math.max(0, band.bottom - band.top)}
                      className="mini-band"
                    />
                  )}
                  {path && <path d={path} className="mini-past" style={{ stroke: color }} />}
                </svg>
                <span>
                  {day.peak ? (
                    <>
                      Peak <b>{number(day.peak.value)}%</b> at{" "}
                      {clock(day.day.start + day.peak.hour * 3_600_000)}
                    </>
                  ) : (
                    "No peak recorded"
                  )}
                </span>
                <span>
                  {day.today
                    ? `${day.shots} ${day.shots === 1 ? "shot" : "shots"} so far`
                    : `${day.dryback === null ? "" : `Dryback ${number(day.dryback, 0)}% · `}${day.shots} ${day.shots === 1 ? "shot" : "shots"}`}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="muted">Loading the week from Home Assistant’s history…</p>
      )}
    </section>
  );
}

/** A number for the week with a small line of its days beside it. */
export function TrendTile({
  label,
  value,
  note,
  series,
}: {
  label: string;
  value: string;
  note: string;
  series: (number | null)[];
}) {
  const known = series.filter((item): item is number => item !== null);
  const low = Math.min(...known),
    high = Math.max(...known);
  const points = series
    .map((item, i) =>
      item === null
        ? null
        : `${((i / Math.max(1, series.length - 1)) * 60).toFixed(1)},${(18 - ((item - low) / (high - low || 1)) * 16).toFixed(1)}`,
    )
    .filter(Boolean)
    .join(" ");
  return (
    <section className="card trend-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
      {known.length > 1 && (
        <svg viewBox="0 0 60 20" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={points} />
        </svg>
      )}
    </section>
  );
}
