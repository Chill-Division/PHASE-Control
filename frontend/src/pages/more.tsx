import { ChevronRight, CircleHelp, Compass, House, Menu, Settings2 } from "lucide-react";
import { EventList, type Page } from "@/components/dashboard";
import { LiveStatus, RunningVersions } from "@/components/shell";
import type { Controller } from "@/lib/types";
import "./more.css";

/** A phone's More tab: what the four tabs leave out, the room's latest records, and the versions. */
export function More({
  controller,
  navigate,
  startTour,
  haMenu,
}: {
  controller: Controller;
  navigate: (page: Page) => void;
  startTour: () => void;
  haMenu: (() => void) | null;
}) {
  const row = (label: string, note: string, Icon: typeof House, act: () => void) => (
    <button type="button" className="more-row" onClick={act} key={label}>
      <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
      <span>
        <strong>{label}</strong>
        <small>{note}</small>
      </span>
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  );
  return (
    <div className="more-page">
      <nav className="more-group" aria-label="Settings">
        {row("Settings", "Water shown as, notifications, appearance", Settings2, () =>
          navigate("settings"),
        )}
        {row("Rooms & hardware", "Plumbing, probes, pot sizes, tests", House, () =>
          navigate("setup"),
        )}
      </nav>
      <nav className="more-group" aria-label="Help">
        {row("Help", "The phases, the terms and every error code", CircleHelp, () =>
          navigate("help"),
        )}
        {row("Take the tour", "Six stops, two minutes", Compass, startTour)}
        {haMenu && row("Home Assistant’s menu", "Back to the rest of Home Assistant", Menu, haMenu)}
      </nav>
      <section className="more-group more-activity" aria-labelledby="more-activity">
        <div className="more-activity-head">
          <h2 id="more-activity">Recent activity</h2>
          <button type="button" className="link-button" onClick={() => navigate("activity")}>
            Activity log
          </button>
        </div>
        <EventList events={controller.room.events.slice(0, 3)} />
      </section>
      <p className="more-foot">
        <LiveStatus controller={controller} />
        <RunningVersions controller={controller} />
      </p>
    </div>
  );
}
