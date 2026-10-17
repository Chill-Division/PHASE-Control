import { useEffect, useState, type ReactNode } from "react";
import {
  Beaker,
  CalendarRange,
  ChartNoAxesCombined,
  CircleHelp,
  Ellipsis,
  House,
  Menu,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { ActivityPanel } from "@/components/activity-panel";
import { BrandGlyph } from "@/components/brand-glyph";
import { DayDial, phaseColor } from "@/components/day-dial";
import { time } from "@/components/dashboard";
import { ageText } from "@/lib/controller-health";
import { roomStatus, runningVersions } from "@/lib/model";
import { MODE_WORDS, roomClock, roomMode, zoneColor } from "@/lib/room-mode";
import type { Controller, Room } from "@/lib/types";
import "./shell.css";

export type SectionId = "overview" | "plan" | "insights" | "feed" | "settings" | "help";
const ICONS: Record<SectionId, typeof House> = {
  overview: House,
  plan: CalendarRange,
  insights: ChartNoAxesCombined,
  feed: Beaker,
  settings: Settings2,
  help: CircleHelp,
};
/** The rail's and the phone tabs' short names. */
export const SHORT: Record<SectionId, string> = {
  overview: "Overview",
  plan: "Strategy",
  insights: "Insights",
  feed: "Feed",
  settings: "Settings",
  help: "Help",
};

function Badge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <i className="rail-badge" aria-label={`${count} unsaved ${count === 1 ? "change" : "changes"}`}>
      {count}
    </i>
  );
}

/** The sections down the left of a tablet or a desktop: Overview, Strategy, Insights and Feed, then
 * Settings and Help, and Home Assistant's own menu when the dashboard is inside it. */
export function Rail({
  section,
  open,
  drafts,
  haMenu,
}: {
  section: SectionId;
  open: (id: SectionId) => void;
  drafts: number;
  haMenu: (() => void) | null;
}) {
  const item = (id: SectionId) => {
    const Icon = ICONS[id];
    return (
      <button
        key={id}
        type="button"
        className="rail-item"
        aria-current={section === id ? "page" : undefined}
        onClick={() => open(id)}
      >
        <span className="rail-icon">
          <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
          {id === "plan" && <Badge count={drafts} />}
        </span>
        {SHORT[id]}
      </button>
    );
  };
  return (
    <nav className="app-rail" aria-label="Sections">
      {/* The column runs the page's full height; what is in it stays put while the page scrolls. */}
      <div className="app-rail-inner">
        <a
          href="#/overview"
          className="rail-brand"
          aria-label="PHASE Control: Overview"
          onClick={(event) => {
            event.preventDefault();
            open("overview");
          }}
        >
          <span className="brand-mark">
            <BrandGlyph />
          </span>
        </a>
        {(["overview", "plan", "insights", "feed"] as const).map(item)}
        <span className="rail-spacer" />
        {(["settings", "help"] as const).map(item)}
        {haMenu && (
          <button type="button" className="rail-item rail-ha" onClick={haMenu}>
            <span className="rail-icon">
              <Menu size={22} strokeWidth={1.8} aria-hidden="true" />
            </span>
            Home Assistant
          </button>
        )}
      </div>
    </nav>
  );
}

/** The phone's sections, at the foot of the screen: the four, and More for the rest. */
export function PhoneTabs({
  section,
  more,
  open,
  openMore,
  drafts,
}: {
  section: SectionId;
  more: boolean;
  open: (id: SectionId) => void;
  openMore: () => void;
  drafts: number;
}) {
  const tab = (id: SectionId | "more") => {
    const Icon = id === "more" ? Ellipsis : ICONS[id];
    const current = id === "more" ? more : !more && section === id;
    return (
      <button
        key={id}
        type="button"
        className="phone-tab"
        aria-current={current ? "page" : undefined}
        onClick={() => (id === "more" ? openMore() : open(id))}
      >
        <span className="phone-tab-icon">
          <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
          {id === "plan" && <Badge count={drafts} />}
        </span>
        {id === "more" ? "More" : SHORT[id]}
      </button>
    );
  };
  return (
    <nav className="phone-tabs" aria-label="Sections">
      {(["overview", "plan", "insights", "feed", "more"] as const).map(tab)}
    </nav>
  );
}

/** A room's mini clock: its lights and each zone's phase now. */
export function MiniDial({
  controller,
  room,
  size,
  now,
}: {
  controller: Controller;
  room: Room;
  size: number;
  now: number;
}) {
  const clock = roomClock(controller.states, room, now);
  if (clock.hours === null || clock.photoperiod === null)
    return (
      <span className="mini-dial-none" style={{ width: size, height: size }} aria-hidden="true" />
    );
  return (
    <DayDial
      size={size}
      mini
      photoperiod={clock.photoperiod}
      now={clock.hours}
      label={`${room.name}: ${Math.floor(clock.hours)} h into its grow-day`}
      zones={clock.zones.map((zone, index) => ({
        id: zone.id,
        name: zone.name,
        color: zoneColor(index),
        bands: [],
        shots: [],
        phase: zone.phase,
      }))}
    />
  );
}

const MODE_DOT: Record<string, string> = {
  steering: "var(--good)",
  watching: "var(--muted-foreground)",
  off: "var(--muted-foreground)",
};
function useTick(ms: number) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
}

/** Every room, as a place: its clock, how it runs and whether anything needs doing. A desktop's
 * second column; hidden with one room. */
export function RoomsColumn({
  controller,
  choose,
}: {
  controller: Controller;
  choose: (id: string) => void;
}) {
  useTick(15_000);
  const now = Date.now();
  const offline = controller.connection === "offline";
  return (
    <nav className="rooms-column" aria-label="Rooms" data-offline={offline || undefined}>
      <div className="rooms-column-inner">
        <div className="rooms-column-head">
          <h2>Rooms</h2>
          <span>{controller.rooms.length}</span>
        </div>
        {controller.rooms.map((room) => {
          const status = roomStatus(controller.states, room, now);
          const { mode } = roomMode(controller.states, room);
          return (
            <button
              key={room.id}
              type="button"
              className="room-card"
              data-tone={status.tone}
              aria-current={room.id === controller.roomId ? "page" : undefined}
              onClick={() => choose(room.id)}
            >
              <MiniDial controller={controller} room={room} size={44} now={now} />
              <span className="room-card-text">
                <span className="room-card-head">
                  <strong>{room.name}</strong>
                  {mode && (
                    <span className="room-card-mode">
                      <i style={{ background: MODE_DOT[mode] }} aria-hidden="true" />
                      {MODE_WORDS[mode].label}
                    </span>
                  )}
                </span>
                <span className="room-card-line">
                  {/* Home Assistant out of reach: what each room last said, and said so. */}
                  {offline ? "Last known: " : ""}
                  {status.text}
                  {status.tone === "watering" || status.tone === "holding"
                    ? ""
                    : ` · ${status.detail}`}
                </span>
              </span>
            </button>
          );
        })}
        <p className="rooms-column-foot">
          Each room’s clock shows where its day is: lights on top, one ring a zone, the hand at now.
        </p>
      </div>
    </nav>
  );
}

/** The rooms as chips, on a phone or a tablet: hidden with one room. */
export function RoomChips({
  controller,
  choose,
}: {
  controller: Controller;
  choose: (id: string) => void;
}) {
  useTick(30_000);
  if (controller.rooms.length < 2) return null;
  const now = Date.now();
  return (
    <nav className="room-chips" aria-label="Rooms">
      {controller.rooms.map((room) => {
        const status = roomStatus(controller.states, room, now);
        return (
          <button
            key={room.id}
            type="button"
            className="room-chip"
            data-tone={status.tone}
            aria-current={room.id === controller.roomId ? "page" : undefined}
            onClick={() => choose(room.id)}
          >
            <MiniDial controller={controller} room={room} size={28} now={now} />
            <span>{room.name}</span>
            <i aria-label={status.text} />
          </button>
        );
      })}
    </nav>
  );
}

/** Live, demo, connecting or offline, and when the newest data came. */
export function LiveStatus({ controller }: { controller: Controller }) {
  useTick(30_000);
  const at = controller.lastUpdated;
  const age = at ? Date.now() - new Date(at).getTime() : null;
  const text =
    controller.connection === "live"
      ? `Live · updated ${time(at)}`
      : controller.connection === "demo"
        ? `Demo data · ${time(at)}`
        : controller.connection === "connecting"
          ? "Connecting…"
          : at
            ? `Offline · last ${time(at)}${age !== null ? ` (${ageText(age)} ago)` : ""}`
            : "Offline";
  return (
    <span className="live-status" data-connection={controller.connection}>
      <i aria-hidden="true" />
      {text}
    </span>
  );
}

/** What every page's header ends with: the connection, a refresh, and the latest records. */
export function Utilities({
  controller,
  refresh,
  refreshing,
  openLog,
}: {
  controller: Controller;
  refresh: () => void;
  refreshing: boolean;
  openLog: () => void;
}) {
  return (
    <div className="page-utilities">
      <LiveStatus controller={controller} />
      <button
        type="button"
        className="icon-button"
        aria-label="Refresh controller data"
        title="Refresh"
        disabled={refreshing || controller.connection === "connecting"}
        onClick={refresh}
      >
        <RefreshCw size={18} className={refreshing ? "spin" : ""} aria-hidden="true" />
      </button>
      <ActivityPanel controller={controller} openLog={openLog} />
    </div>
  );
}

/** A section's header: its name, its tabs as one control, and the utilities. */
export function SectionHeader({
  title,
  tabs,
  current,
  choose,
  utilities,
}: {
  title: string;
  tabs: readonly { id: string; label: string }[];
  current: string;
  choose: (id: string) => void;
  utilities: ReactNode;
}) {
  return (
    <header className="section-header">
      <h1 className="section-title">{title}</h1>
      {tabs.length > 1 && (
        <div className="segmented section-tabs" role="navigation" aria-label={`${title} views`}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-current={current === tab.id ? "page" : undefined}
              onClick={() => choose(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      <span className="section-header-gap" />
      {utilities}
    </header>
  );
}

export { phaseColor };

/** The versions the running integration and controller report, to quote in a problem report. Not in
 * the demo, which runs neither. */
export function RunningVersions({ controller }: { controller: Controller }) {
  if (controller.demo) return null;
  const versions = runningVersions(controller.states, controller.room.room);
  return (
    <dl
      className="running-versions"
      aria-label="Running versions"
      title="Reported by the running integration and controller, not by this page"
    >
      <div>
        <dt>Integration</dt>
        <dd>{versions.integration ?? "not reported"}</dd>
      </div>
      <div>
        <dt>Controller</dt>
        <dd>{versions.controller ?? "not reported"}</dd>
      </div>
    </dl>
  );
}
