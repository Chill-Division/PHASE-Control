import "./day-dial.css";

/** One phase of a zone's grow-day on the clock, in hours since lights-on (0 to 24). `ahead`: the rest
 * of the day as the controller is expected to run it, drawn faded. */
export interface DialBand {
  phase: string;
  start: number;
  end: number;
  ahead?: boolean;
}
/** One zone's ring: its phases, the shots it has had (hours since lights-on) and those expected. */
export interface DialZone {
  id: number;
  name: string;
  color: string;
  bands: DialBand[];
  shots: number[];
  planned?: number[];
  /** Only the phase it is in now (another room's clock): a dot at now, in the phase's colour. */
  phase?: string | null;
}

const PHASE_VAR: Record<string, string> = {
  P0: "var(--phase-p0)",
  P1: "var(--phase-p1)",
  P2: "var(--phase-p2)",
  P3: "var(--phase-p3)",
};
export const phaseColor = (phase: string | null | undefined) =>
  (phase && PHASE_VAR[phase]) || "var(--muted-foreground)";

const round = (n: number) => Math.round(n * 100) / 100;

/** An hour of the day as this browser writes the time, short: "16:00", or "4 PM", "4:30 PM". */
export function hourText(hour: number): string {
  const at = new Date(2000, 0, 1, Math.floor(hour), Math.round((hour % 1) * 60));
  const twelve = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12;
  return at.toLocaleTimeString(
    undefined,
    twelve
      ? { hour: "numeric", ...(at.getMinutes() ? { minute: "2-digit" } : {}) }
      : { hour: "2-digit", minute: "2-digit" },
  );
}

/** The grow-day as a 24-hour clock: lights-on at the top, the day running clockwise, the outer ring
 * light and dark, one ring a zone (outside in), its phases dawn to night, a notch for each shot, and
 * a hand at now. `mini` is the rooms column's: rings and the hand, no hours or words. */
export function DayDial({
  size,
  photoperiod,
  now,
  zones,
  lightsOn,
  mini = false,
  label,
  center,
}: {
  size: number;
  /** Hours the lights are on, from lights-on. */
  photoperiod: number;
  /** Hours since lights-on. */
  now: number;
  zones: DialZone[];
  /** The hour of the day lights come on, 6.5 for 06:30, for the hour labels. */
  lightsOn?: number;
  mini?: boolean;
  label: string;
  center?: { time: string; note?: string };
}) {
  const c = size / 2;
  const lightsW = mini ? 3 : 6;
  const lightsR = mini ? c - 2 : c - 26;
  const count = Math.max(1, zones.length);
  // The rings share the room inside the lights ring, leaving the middle for the time.
  const firstR = lightsR - (mini ? 5 : 17);
  const inner = mini ? c * 0.3 : c * 0.52;
  const step = count > 1 ? Math.min(mini ? 5.5 : 19, (firstR - inner) / (count - 1)) : 0;
  const ringW = mini ? Math.max(2, Math.min(4, step - 1.5)) : Math.max(5, Math.min(14, step - 5));
  const ang = (t: number) => (t / 24) * Math.PI * 2 - Math.PI / 2;
  const pt = (r: number, t: number) => [c + r * Math.cos(ang(t)), c + r * Math.sin(ang(t))];
  const arc = (r: number, a: number, b: number) => {
    if (b - a <= 0.001) return "";
    const end = Math.min(b, a + 23.999);
    const [x0, y0] = pt(r, a),
      [x1, y1] = pt(r, end);
    return `M${round(x0)} ${round(y0)}A${round(r)} ${round(r)} 0 ${end - a > 12 ? 1 : 0} 1 ${round(x1)} ${round(y1)}`;
  };
  const radial = (r0: number, r1: number, t: number) => {
    const [x0, y0] = pt(r0, t),
      [x1, y1] = pt(r1, t);
    return `M${round(x0)} ${round(y0)}L${round(x1)} ${round(y1)}`;
  };
  const clampHour = (t: number) => Math.max(0, Math.min(24, t));
  const hand = pt(lightsR, now);
  // Every six hours from lights-on, outside the lights ring: further out at the sides, where a time
  // is wider than it is tall.
  const hours =
    mini || lightsOn === undefined
      ? []
      : [0, 6, 12, 18].map((h) => {
          const [x, y] = pt(lightsR + (h % 12 ? 20 : 14), h);
          return { text: hourText((lightsOn + h) % 24), x, y };
        });
  // "11:18 AM": the hour and minute large, AM or PM beside them small.
  const parts = center && /^(.+?)\s*([AaPp]\.?\s?[Mm]\.?)$/.exec(center.time);
  return (
    <div
      className={`day-dial${mini ? " day-dial-mini" : ""}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <path
          d={arc(lightsR, 0, clampHour(photoperiod))}
          className="dial-lights-on"
          style={{ strokeWidth: lightsW }}
        />
        <path
          d={arc(lightsR, clampHour(photoperiod), 24)}
          className="dial-lights-off"
          style={{ strokeWidth: lightsW }}
        />
        {zones.map((zone, index) => {
          const r = firstR - index * step;
          return (
            <g key={zone.id}>
              <circle cx={c} cy={c} r={r} className="dial-track" style={{ strokeWidth: ringW }} />
              {zone.bands.map((band, i) => (
                <path
                  key={i}
                  d={arc(r, clampHour(band.start), clampHour(band.end))}
                  className={band.ahead ? "dial-band dial-ahead" : "dial-band"}
                  style={{ stroke: phaseColor(band.phase), strokeWidth: ringW }}
                />
              ))}
              {zone.shots.map((t, i) => (
                <path
                  key={`s${i}`}
                  d={radial(r - ringW / 2 - 1, r + ringW / 2 + 1, clampHour(t))}
                  className="dial-shot"
                />
              ))}
              {(zone.planned ?? []).map((t, i) => (
                <path
                  key={`p${i}`}
                  d={radial(r - ringW / 2, r + ringW / 2, clampHour(t))}
                  className="dial-shot dial-ahead"
                />
              ))}
              {zone.phase !== undefined && !zone.bands.length && (
                <circle
                  cx={pt(r, clampHour(now))[0]}
                  cy={pt(r, clampHour(now))[1]}
                  r={Math.max(1.6, ringW / 2 + 0.5)}
                  style={{ fill: phaseColor(zone.phase) }}
                />
              )}
            </g>
          );
        })}
        {/* From the inside of the rings out, so the hand never crosses the time in the middle. */}
        <path
          d={radial(
            mini ? 0 : firstR - (count - 1) * step - ringW / 2 - 4,
            lightsR,
            clampHour(now),
          )}
          className="dial-hand"
        />
        <circle
          cx={round(hand[0])}
          cy={round(hand[1])}
          r={mini ? 2 : 4.5}
          className="dial-hand-dot"
        />
      </svg>
      {hours.map((h) => (
        <span key={h.text} className="dial-hour" style={{ left: h.x, top: h.y }}>
          {h.text}
        </span>
      ))}
      {center && !mini && (
        <span
          className="dial-center"
          style={{ width: (firstR - (count - 1) * step - ringW) * 1.6 }}
        >
          <strong>
            {parts ? parts[1] : center.time}
            {parts && <small>{parts[2]}</small>}
          </strong>
          {center.note && <small>{center.note}</small>}
        </span>
      )}
    </div>
  );
}
