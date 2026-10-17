import { useEffect, useRef, useState, type RefObject } from "react";
import {
  CalendarRange,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CirclePause,
  Clock,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DayDial, phaseColor, type DialBand } from "@/components/day-dial";
import {
  number,
  ReviewDialog,
  time as clock,
  ZoneActions,
  type Page,
} from "@/components/dashboard";
import { nextText, type Lane } from "@/components/day-timeline";
import { ageText } from "@/lib/controller-health";
import type { DrybackTrend } from "@/lib/dryback";
import type { GrowDay } from "@/lib/day-timeline";
import { roomStatus } from "@/lib/model";
import { scheduleDays } from "@/components/targets-banner";
import { MODE_WORDS, modeChanges, roomMode, zoneColor, type RoomMode } from "@/lib/room-mode";
import type { Controller, Notice, Zone } from "@/lib/types";
import { dailyWater } from "@/lib/water-delivery";
import { mlPerPlant, plantText, roomPerPlant, useWaterView } from "@/lib/water-view";
import "./overview-parts.css";

export const PHASE_LONG: Record<string, string> = {
  P0: "Morning dryback",
  P1: "Ramp-up",
  P2: "Maintenance",
  P3: "Overnight",
};
const INTO: Record<string, string> = {
  P0: "Into P0, the morning dryback",
  P1: "Into P1, the ramp-up",
  P2: "Into P2, maintenance",
  P3: "Into P3, the overnight dryback",
};
const live = (controller: Controller) => ["live", "demo"].includes(controller.connection);
const hoursOf = (day: GrowDay, time: number) => (time - day.start) / 3_600_000;
/** "in 7 min", "in 2 h 55 min", "now". */
export function inTime(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes <= 0) return "now";
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60),
    m = minutes % 60;
  return `in ${h} h${m ? ` ${m} min` : ""}`;
}
/** Whether a media query matches now, following it as the window changes. */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const change = () => setMatches(list.matches);
    change();
    list.addEventListener("change", change);
    return () => list.removeEventListener("change", change);
  }, [query]);
  return matches;
}
/** An element's width as it changes; 0 until it is laid out. */
export function useWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

// ------------------------------------------------------------------ how the room runs
/** What a change of how the room runs does, in the words its two switches always used. */
function modeNote(from: RoomMode | null, to: RoomMode, name: string): string {
  if (to === "off")
    return `Nothing growing in ${name}? Irrigation and alerts stop until you switch it back on.`;
  const waking =
    from === "off"
      ? "Back on within a day, it carries on where it was. After longer, it starts a fresh run: daily counters and learned phase state reset. "
      : "";
  return to === "steering"
    ? `${waking}The controller waters this room by its targets again.`
    : `${waking}The controller opens no valve in this room and stops a running shot within a few seconds; it keeps reading the probes and following the phases. It is not an emergency stop: use the installation's physical shut-off for that.`;
}
/** Steering, Watching only or Room off: one choice in a pill, picked in a sheet and reviewed. */
export function ModeControl({ controller }: { controller: Controller }) {
  const room = controller.room.room;
  const state = roomMode(controller.states, room);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<RoomMode | null>(null);
  // The review keeps what it was opened with: its own writes move the room under it.
  const [opened, setOpened] = useState<{
    from: RoomMode | null;
    items: ReturnType<typeof modeChanges>;
  }>({ from: null, items: [] });
  if (!state.engineEntity && !state.roomActiveEntity) return null;
  const words = state.mode ? MODE_WORDS[state.mode].label : "Unknown";
  const choices = (["steering", "watching", "off"] as const).filter(
    (mode) => mode !== "off" || state.roomActiveEntity,
  );
  return (
    <>
      <button
        type="button"
        className="mode-pill"
        data-mode={state.mode ?? "unknown"}
        aria-haspopup="dialog"
        aria-label={`How ${room.name} runs: ${words}. Change`}
        disabled={!live(controller)}
        onClick={() => setOpen(true)}
      >
        <i aria-hidden="true" />
        {words}
        <ChevronDown size={17} aria-hidden="true" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="mode-dialog">
          <DialogHeader>
            <DialogTitle>How {room.name} runs</DialogTitle>
            <DialogDescription>
              One choice for the room’s two switches. You review it before anything changes.
            </DialogDescription>
          </DialogHeader>
          <div className="mode-options" role="radiogroup" aria-label={`How ${room.name} runs`}>
            {choices.map((mode) => {
              const items = modeChanges(state, mode, room.name);
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={state.mode === mode}
                  className="mode-option"
                  data-mode={mode}
                  disabled={state.mode === mode || !items.length}
                  onClick={() => {
                    setOpen(false);
                    setOpened({ from: state.mode, items });
                    setTarget(mode);
                  }}
                >
                  <span className="mode-option-head">
                    <i aria-hidden="true" />
                    <strong>{MODE_WORDS[mode].label}</strong>
                    {state.mode === mode && <span className="mode-now">Now</span>}
                  </span>
                  <span>{MODE_WORDS[mode].text}</span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
      <ReviewDialog
        open={target !== null}
        onOpenChange={(next) => !next && setTarget(null)}
        controller={controller}
        title={target ? `${MODE_WORDS[target].label}: ${room.name}` : ""}
        items={opened.items}
        note={target ? modeNote(opened.from, target, room.name) : undefined}
      />
    </>
  );
}

/** Which targets the room runs on: its armed Schedule, on its day, or Today's. Told apart at a
 * glance: the Schedule in indigo with a calendar, Today's in blue with sliders. */
export function TargetsSource({
  controller,
  navigate,
}: {
  controller: Controller;
  navigate: (page: Page) => void;
}) {
  const { engaged } = controller.room.strategy;
  if (!engaged)
    return (
      <button
        type="button"
        className="source-chip"
        data-source="today"
        title="No schedule is armed: the room runs on the targets set in Irrigation strategy → Today."
        onClick={() => navigate("strategy")}
      >
        <SlidersHorizontal size={15} aria-hidden="true" />
        Today’s targets
      </button>
    );
  const day = scheduleDays(controller);
  return (
    <button
      type="button"
      className="source-chip"
      data-source="schedule"
      title="An armed schedule sets this room's targets at each lights-on: Irrigation strategy → Schedule."
      onClick={() => navigate("grow-plan")}
    >
      <CalendarRange size={15} aria-hidden="true" />
      Schedule in charge{day ? ` · ${day}` : ""}
    </button>
  );
}

// ------------------------------------------------------------------ the room's line
const TONE_ICON = {
  watering: CircleCheck,
  holding: CircleDot,
  stopped: CircleAlert,
  stale: TriangleAlert,
  off: CirclePause,
} as const;
/** How the room is doing now, in one line, and today's water and shots so far. */
export function StatusRow({
  controller,
  plants,
  navigate,
}: {
  controller: Controller;
  plants: Record<number, number | null>;
  navigate: (page: Page) => void;
}) {
  const room = controller.room;
  const status = roomStatus(controller.states, room.room);
  const Icon = TONE_ICON[status.tone];
  const water = room.metrics.find((metric) => metric.key === "water")?.value ?? null;
  const shots = room.metrics.find((metric) => metric.key === "shots")?.value ?? null;
  const perPlant = roomPerPlant(room.zones, plants);
  // The Overview's own fix is its mode pill, in its heading.
  const action = status.action?.route === "overview" ? undefined : status.action;
  return (
    <div className="status-row" data-tone={status.tone} data-room-status={room.room.id}>
      <p className="status-row-text">
        <Icon size={20} aria-hidden="true" />
        <span>
          <strong>{status.text}</strong>
          {status.tone === "watering" || status.tone === "holding" ? ": " : ". "}
          {status.detail}
          {action && (
            <>
              {" "}
              <button
                type="button"
                className="link-button"
                onClick={() => navigate(action.route as Page)}
              >
                {action.label}
              </button>
            </>
          )}
        </span>
      </p>
      {(water !== null || shots !== null) && (
        <p className="status-row-totals">
          Today so far: {water !== null && <strong>{number(water)} L</strong>}
          {perPlant && <>, {plantText(perPlant.ml)} a plant</>}
          {shots !== null && (
            <>
              {" "}
              · <strong>{number(shots, 0)} shots</strong>
            </>
          )}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ needs you
const SEVERITY = { critical: "Critical", warning: "Warning", info: "Info" } as const;
/** The room's notices, the most urgent first: what each means and where to go about it. */
export function NeedsYou({
  alerts,
  shown,
  more,
  openZone,
}: {
  alerts: Notice[];
  shown: Notice[];
  more: () => void;
  openZone: (id: number) => void;
}) {
  if (!alerts.length) return null;
  return (
    <section className="card needs-you" aria-labelledby="needs-you-title" data-needs-you>
      <div className="card-head">
        <h2 id="needs-you-title">Needs you</h2>
        <span>
          {alerts.length}
          {alerts.length > 1 ? " · the most urgent first" : ""}
        </span>
      </div>
      {shown.map((notice) => {
        const code = /CS-\d{3}/.exec(`${notice.title} ${notice.detail}`)?.[0];
        return (
          <article
            key={notice.id}
            className="needs-row"
            data-severity={notice.severity}
            data-notice={notice.id}
          >
            <span className="needs-icon" aria-hidden="true">
              {notice.severity === "info" ? <CircleDot size={18} /> : <TriangleAlert size={18} />}
            </span>
            <span className="needs-text">
              <span className="needs-title">
                <span className="tone-badge" data-tone={notice.severity}>
                  {SEVERITY[notice.severity]}
                </span>
                <strong>{notice.title}</strong>
              </span>
              <span>{notice.detail}</span>
            </span>
            {(notice.zoneId !== undefined || code) && (
              <span className="needs-actions">
                {notice.zoneId !== undefined && (
                  <button
                    type="button"
                    className="button-quiet"
                    onClick={() => openZone(notice.zoneId!)}
                  >
                    View zone
                  </button>
                )}
                {code && (
                  <a className="link-button" href={`#/help?code=${code}`}>
                    What {code} means
                  </a>
                )}
              </span>
            )}
          </article>
        );
      })}
      {alerts.length > shown.length && (
        <button type="button" className="link-button needs-more" onClick={more}>
          Show {alerts.length - shown.length} more{" "}
          {alerts.length - shown.length === 1 ? "notice" : "notices"}
        </button>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ the clock
/** Each zone's grow-day for the clock: its phases so far, the rest as projected, its shots. */
export function dialZones(lanes: Lane[], day: GrowDay, now: number) {
  return lanes.map((lane, index) => {
    const ahead: DialBand[] = [];
    for (const point of lane.projection?.points ?? []) {
      if (point.time < now) continue;
      const hour = hoursOf(day, point.time),
        last = ahead.at(-1);
      if (last && last.phase === point.phase) last.end = hour;
      else {
        if (last) last.end = hour;
        ahead.push({ phase: point.phase, start: hour, end: hour, ahead: true });
      }
    }
    if (ahead.length) ahead.at(-1)!.end = hoursOf(day, day.end);
    return {
      id: lane.zone.id,
      name: lane.zone.name,
      color: zoneColor(index),
      phase: lane.phase ?? undefined,
      bands: [
        ...lane.bands.map((band) => ({
          phase: band.phase,
          start: hoursOf(day, band.start),
          end: hoursOf(day, band.end),
        })),
        ...ahead,
      ],
      shots: lane.shots.map((shot) => hoursOf(day, shot.start)),
      planned: (lane.projection?.shots ?? [])
        .filter((shot) => shot.time > now)
        .map((shot) => hoursOf(day, shot.time)),
    };
  });
}
/** What the clock card's heading says: the phase every zone is in and since when, or the phases. */
function phaseSummary(lanes: Lane[]): string {
  const phases = [...new Set(lanes.map((lane) => lane.phase).filter(Boolean))] as string[];
  if (!phases.length) return "Phase unavailable";
  if (phases.length > 1) return `In ${phases.sort().join(" and ")}`;
  const since = Math.min(...lanes.map((lane) => lane.since ?? Infinity));
  return Number.isFinite(since) ? `${phases[0]} since ${clock(since)}` : phases[0];
}
/** Today on the clock: lights-on at the top, one ring a zone, its phases and shots, the hand at
 * now. Before history loads, each zone's phase now from its sensor. */
export function TodayCard({
  controller,
  day,
  lanes,
  now,
  held,
}: {
  controller: Controller;
  day: GrowDay | null;
  lanes: Lane[] | null;
  now: number;
  /** The room's own line when it is not watering, in its place in the heading. */
  held: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const size = Math.max(200, Math.min(320, width || 300));
  const fallback = controller.room.zones.map((zone, index) => ({
    id: zone.id,
    name: zone.name,
    color: zoneColor(index),
    phase: /^P[0-3]$/.test(zone.phase) ? zone.phase : undefined,
    bands: [],
    shots: [],
  }));
  const zones = day && lanes ? dialZones(lanes, day, now) : fallback;
  const before = day ? now < day.lightsOff : false;
  const until = day ? (before ? day.lightsOff : day.end) - now : 0;
  return (
    <section className="card today-card" aria-labelledby="today-title" data-today>
      <div className="card-head">
        <h2 id="today-title">Today</h2>
        {held ? (
          <span className="today-held">{held}</span>
        ) : (
          <span>{lanes ? phaseSummary(lanes) : day ? "Loading today…" : ""}</span>
        )}
      </div>
      <div className="today-dial" ref={box}>
        {day ? (
          <DayDial
            size={size}
            photoperiod={hoursOf(day, day.lightsOff)}
            now={hoursOf(day, now)}
            lightsOn={new Date(day.start).getHours() + new Date(day.start).getMinutes() / 60}
            zones={zones}
            label={`${controller.room.room.name}'s grow-day: ${zones
              .map((zone) => `${zone.name} ${zone.phase ?? "phase unknown"}`)
              .join(", ")}; lights ${before ? "off" : "on"} ${inTime(until)}`}
            center={{ time: clock(now), note: `Lights ${before ? "off" : "on"} ${inTime(until)}` }}
          />
        ) : (
          <p className="muted today-none">
            No lights hours: set the room’s lights-on and lights-off hours in Irrigation strategy →
            Today to draw its grow-day.
          </p>
        )}
      </div>
      {day && (
        <div className="dial-legend">
          <span className="dial-legend-row">
            <span className="muted">Rings, outside in:</span>
            {zones.map((zone) => (
              <span key={zone.id}>
                <i style={{ background: zone.color }} aria-hidden="true" />
                {zone.name}
              </span>
            ))}
          </span>
          <span className="dial-legend-row">
            {["P0", "P1", "P2", "P3"].map((phase) => (
              <span key={phase}>
                <b style={{ background: phaseColor(phase) }} aria-hidden="true" />
                {phase}
              </span>
            ))}
            <span>
              <em aria-hidden="true" />a shot
            </span>
            <span className="muted">· faded: still to come</span>
          </span>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ coming up
export interface Upcoming {
  time: number;
  who: string;
  color: string;
  text: string;
  /** Now, rather than a time: a shot that is due. */
  due?: boolean;
}
/** The rest of the grow-day, in order: each zone's next shot, the phase changes its projection
 * expects, and the lights. A change the zones make together is one line. */
export function comingUp(lanes: Lane[], day: GrowDay, now: number): Upcoming[] {
  const items: Upcoming[] = [];
  const merged = new Map<string, { time: number; names: string[]; color: string; text: string }>();
  lanes.forEach((lane, index) => {
    const color = zoneColor(index),
      who = lane.zone.name;
    const { next } = lane;
    if (!lane.stopped && next.at !== null) {
      const text =
        next.basis === "due"
          ? `A shot now: at or under its ${number(lane.target)}% trigger`
          : next.basis === "p0-wait"
            ? "First ramp-up shot, at the latest"
            : next.basis === "p1-interval"
              ? `Ramp-up shot ${lane.p1Shots + 1}`
              : next.basis === "dry-down" && lane.target !== null
                ? `A shot once it dries to ${number(lane.target)}% (estimate)`
                : null;
      if (text)
        items.push({ time: Math.max(next.at, now), who, color, text, due: next.basis === "due" });
    }
    let phase = lane.phase;
    for (const point of lane.projection?.points ?? []) {
      if (point.time <= now || point.time >= day.end) {
        phase = point.phase;
        continue;
      }
      if (phase && point.phase !== phase) {
        const key = `${point.phase}@${Math.round(point.time / 600_000)}`;
        const found = merged.get(key);
        if (found) found.names.push(who);
        else
          merged.set(key, {
            time: point.time,
            names: [who],
            color,
            text: `${INTO[point.phase] ?? `Into ${point.phase}`} (predicted)`,
          });
      }
      phase = point.phase;
    }
  });
  for (const change of merged.values())
    items.push({
      time: change.time,
      who:
        change.names.length === lanes.length && lanes.length > 1
          ? "All zones"
          : change.names.join(", "),
      color: change.names.length > 1 ? "var(--muted-foreground)" : change.color,
      text: change.text,
    });
  if (day.lightsOff > now)
    items.push({
      time: day.lightsOff,
      who: "Room",
      color: "var(--foreground)",
      text: "Lights off",
    });
  return items.sort((a, b) => a.time - b.time);
}
export function ComingUp({
  items,
  day,
  now,
  limit,
  loading,
}: {
  items: Upcoming[];
  day: GrowDay | null;
  now: number;
  limit: number;
  loading: boolean;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, limit);
  const tomorrow = day && new Date(day.end).toDateString() !== new Date(now).toDateString();
  return (
    <section className="card coming-up" aria-labelledby="coming-up-title" data-coming-up>
      <div className="card-head">
        <h2 id="coming-up-title">Coming up</h2>
        {items.length > limit && !all ? (
          <button type="button" className="link-button" onClick={() => setAll(true)}>
            {items.length - limit} more today
          </button>
        ) : (
          <span>The rest of the grow-day, in order</span>
        )}
      </div>
      {loading ? (
        <p className="muted">Working out the rest of the day from today’s readings…</p>
      ) : shown.length ? (
        <ol className="upcoming-list">
          {shown.map((item, index) => (
            <li key={index} data-first={index === 0 || undefined}>
              <span className="upcoming-when">
                <strong>{item.due ? "Now" : clock(item.time)}</strong>
                <small>{item.due ? "due" : inTime(item.time - now)}</small>
              </span>
              <span className="upcoming-who">
                <i style={{ background: item.color }} aria-hidden="true" />
                {item.who}
              </span>
              <span className="upcoming-text">{item.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Nothing more is expected before lights-on.</p>
      )}
      {day && (
        <p className="upcoming-foot">
          {tomorrow ? "Tomorrow " : ""}
          {clock(day.end)}: lights on, a new grow-day
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ a zone's card
type FootTone = "next" | "paused" | "warning" | "critical";
const FOOT_ICON = {
  next: Clock,
  paused: CirclePause,
  warning: TriangleAlert,
  critical: TriangleAlert,
} as const;
/** What a zone's card ends with: what is wrong, in its tone, or what comes next. */
function zoneFoot(
  zone: Zone,
  lane: Lane | undefined,
  day: GrowDay | null,
  notice: Notice | undefined,
): { tone: FootTone; text: string } {
  if (zone.override === true)
    return {
      tone: "paused",
      text: `Paused by hand${zone.overrideUntil ? ` until ${clock(zone.overrideUntil)}` : ""}: no shots, its probes still read`,
    };
  if (zone.enabled === false)
    return { tone: "paused", text: "Scheduling paused: no water at all, not even a rescue shot" };
  if (notice?.severity === "critical") return { tone: "critical", text: notice.title };
  if (zone.stale)
    return { tone: "warning", text: "The controller is not reporting: this is its last word" };
  if (notice?.severity === "warning") return { tone: "warning", text: notice.title };
  const next = lane && day ? nextText(lane, day) : "";
  const text =
    next || (zone.status === "Unavailable" ? "Controller status unavailable" : zone.status);
  return { tone: "next", text: text.charAt(0).toUpperCase() + text.slice(1) };
}
/** A zone at a glance: its phase, moisture and how it moves, EC, water against its limit with
 * its shots, and its own day as a small chart, shaded with its band from trigger to peak. */
export function ZoneCard({
  controller,
  zone,
  index,
  lane,
  day,
  now,
  limit,
  plants,
  trend,
  notice,
  open,
  navigate,
}: {
  controller: Controller;
  zone: Zone;
  index: number;
  lane?: Lane;
  day: GrowDay | null;
  now: number;
  limit: number | null;
  plants: number | null;
  trend?: DrybackTrend;
  /** The zone's most urgent notice, if it has one. */
  notice?: Notice;
  open: () => void;
  navigate: (page: Page, zoneId?: number) => void;
}) {
  const { view } = useWaterView();
  const color = zoneColor(index);
  const water = dailyWater(zone, plants);
  const each = view === "plant" ? water.mlPerPlant : null;
  const eachLimit = each === null ? null : mlPerPlant(limit, plants);
  const share = water.zoneL !== null && limit !== null && limit > 0 ? water.zoneL / limit : null;
  const foot = zoneFoot(zone, lane, day, notice);
  const FootIcon = FOOT_ICON[foot.tone];
  const rate = trend?.rate ?? null;
  const shots = zone.shots.value;
  const phase = /^P[0-3]$/.test(zone.phase) ? zone.phase : null;
  return (
    <article className="zone-card" data-zone-card={zone.id} data-foot={foot.tone}>
      <div className="zone-card-head">
        <i style={{ background: color }} aria-hidden="true" />
        <h3>
          <button type="button" className="zone-card-name" onClick={open}>
            {zone.name}
          </button>
        </h3>
        {phase ? (
          <span className="phase-chip" style={{ background: phaseColor(phase) }}>
            {phase} · {PHASE_LONG[phase]}
          </span>
        ) : (
          <span className="phase-chip" data-unknown="">
            Phase unavailable
          </span>
        )}
        <ZoneActions controller={controller} zone={zone} onOpen={open} navigate={navigate} />
      </div>
      <div className="zone-card-stats">
        <span className="zone-vwc">
          <span>
            <strong data-stale={zone.stale || undefined}>
              {zone.vwc.value === null ? "–" : number(zone.vwc.value)}
            </strong>
            <small>%</small>
          </span>
          <small>
            VWC
            {zone.vwc.value === null
              ? " · no reading"
              : rate === null
                ? ""
                : Math.abs(rate) < 0.05
                  ? " · steady"
                  : ` · ${rate > 0 ? "drying" : "wetting"} ${number(Math.abs(rate), Math.abs(rate) < 1 ? 2 : 1)} pts/h`}
          </small>
        </span>
        <span className="zone-stat">
          <small>EC</small>
          <strong>{zone.ec.value === null ? "–" : number(zone.ec.value)}</strong>
        </span>
        <span
          className="zone-stat"
          data-water-share={share === null ? "" : Math.round(share * 100)}
        >
          <small>
            Water{shots !== null ? ` · ${number(shots, 0)} ${shots === 1 ? "shot" : "shots"}` : ""}
          </small>
          <strong
            data-share={
              share === null ? undefined : share >= 1 ? "full" : share >= 0.8 ? "high" : undefined
            }
          >
            {each !== null
              ? plantText(each)
              : water.zoneL === null
                ? "–"
                : `${number(water.zoneL)}${limit === null ? " L" : ""}`}
            {(eachLimit !== null || (each === null && limit !== null)) && (
              <small> / {eachLimit !== null ? plantText(eachLimit) : `${number(limit)} L`}</small>
            )}
          </strong>
        </span>
      </div>
      {lane && day ? (
        <ZoneMiniChart lane={lane} day={day} now={now} color={color} open={open} />
      ) : (
        <div className="zone-mini-empty">
          {day ? "Today’s readings load here…" : "No lights hours to draw the day on."}
        </div>
      )}
      <p className="zone-card-foot" data-tone={foot.tone} data-zone-status={zone.id}>
        <FootIcon size={16} aria-hidden="true" />
        <span>{foot.text}</span>
      </p>
    </article>
  );
}

/** A zone's day in a card: moisture so far, the rest as projected, the band from its trigger to
 * its peak target, and the night shaded. */
export function ZoneMiniChart({
  lane,
  day,
  now,
  color,
  open,
}: {
  lane: Lane;
  day: GrowDay;
  now: number;
  color: string;
  open?: () => void;
}) {
  const W = 300,
    H = 96;
  const span = day.end - day.start;
  const x = (time: number) => Math.max(0, Math.min(W, ((time - day.start) / span) * W));
  const past = lane.points;
  const ahead = (lane.projection?.points ?? []).filter((point) => point.time >= now);
  const band =
    lane.peakTarget !== null && lane.triggerTarget !== null && lane.peakTarget > lane.triggerTarget
      ? { peak: lane.peakTarget, trigger: lane.triggerTarget }
      : null;
  const values = [
    ...past.map((point) => point.value),
    ...ahead.map((point) => point.value),
    ...(band ? [band.peak, band.trigger] : []),
  ];
  const low = values.length ? Math.min(...values) : 40,
    high = values.length ? Math.max(...values) : 70;
  const pad = Math.max(1, (high - low) * 0.12);
  const y = (value: number) =>
    H - 6 - ((value - (low - pad)) / (high - low + 2 * pad || 1)) * (H - 12);
  const path = (list: { time: number; value: number }[]) =>
    list
      .map((point, i) => `${i ? "L" : "M"}${x(point.time).toFixed(1)} ${y(point.value).toFixed(1)}`)
      .join("");
  const last = past.at(-1);
  const label = `${lane.zone.name} today: moisture${
    band
      ? ` against its band from the maintenance trigger, ${number(band.trigger)}%, to the peak target, ${number(band.peak)}%`
      : ""
  }${last ? `, measured until ${clock(last.time)}` : ", nothing recorded yet"}${ahead.length ? " and projected after" : ""}`;
  const chart = (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <rect
          x={x(day.lightsOff)}
          y={0}
          width={Math.max(0, W - x(day.lightsOff))}
          height={H}
          className="mini-night"
        />
        {band && (
          <rect
            x={0}
            y={y(band.peak)}
            width={W}
            height={Math.max(0, y(band.trigger) - y(band.peak))}
            className="mini-band"
          />
        )}
        {ahead.length > 0 && (
          <path
            d={path(last ? [last, ...ahead] : ahead)}
            className="mini-ahead"
            style={{ stroke: color }}
          />
        )}
        {past.length > 1 && <path d={path(past)} className="mini-past" style={{ stroke: color }} />}
        <path d={`M${x(now).toFixed(1)} 0V${H}`} className="mini-now" />
      </svg>
      {last && (
        <span
          className="mini-dot"
          style={{ left: `${(x(last.time) / W) * 100}%`, top: y(last.value), background: color }}
        />
      )}
      {band && (
        <>
          <span className="mini-label" style={{ top: y(band.peak) }}>
            Peak {number(band.peak)}
          </span>
          <span className="mini-label mini-label-low" style={{ top: y(band.trigger) }}>
            Trigger {number(band.trigger)}
          </span>
        </>
      )}
    </>
  );
  return (
    <div className="zone-mini">
      {open ? (
        <button
          type="button"
          className="zone-mini-chart"
          aria-label={`${label}. Open its details`}
          onClick={open}
        >
          {chart}
        </button>
      ) : (
        <div className="zone-mini-chart" role="img" aria-label={label}>
          {chart}
        </div>
      )}
      <div className="zone-mini-axis" aria-hidden="true">
        <span>{clock(day.start)} lights on</span>
        <span>{clock(day.lightsOff)} off</span>
        <span>{clock(day.end)}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ earlier today
/** The day so far, newest first: phase changes, shots, holds and setting changes, each with its
 * zone or room first. */
export function EarlierToday({
  events,
  loading,
}: {
  events: { time: number; text: string }[];
  loading: boolean;
}) {
  const [all, setAll] = useState(false);
  const newest = [...events].reverse();
  const shown = all ? newest : newest.slice(0, 3);
  return (
    <section className="card earlier-today" aria-labelledby="earlier-title" data-earlier-today>
      <div className="card-head">
        <h2 id="earlier-title">Earlier today</h2>
        {events.length > 3 && (
          <button type="button" className="link-button" onClick={() => setAll(!all)}>
            {all ? "Fewer" : `All ${events.length}`}
          </button>
        )}
      </div>
      {loading ? (
        <p className="muted">Loading today’s recorded history…</p>
      ) : shown.length ? (
        <ol className="earlier-list">
          {shown.map((event, index) => {
            // "07:12–07:14 · Zone 1 · P1 shot 1 min 48 s": the time goes in its own column.
            const [, place, ...rest] = event.text.split(" · ");
            return (
              <li key={index}>
                <time>{clock(event.time)}</time>
                <span>
                  {rest.length ? (
                    <>
                      <strong>{place}</strong> · {rest.join(" · ")}
                    </>
                  ) : (
                    event.text
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="muted">Nothing recorded yet today.</p>
      )}
    </section>
  );
}
