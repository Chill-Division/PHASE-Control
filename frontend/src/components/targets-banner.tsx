import { CalendarRange, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolve } from "@/lib/model";
import { todayMeaning, type ScheduleStatus } from "@/lib/schedule-words";
import type { Controller } from "@/lib/types";
import "./targets-banner.css";

/** What each state of the schedule means for the room, said on the Schedule itself. */
const SCHEDULE_NOTES: Record<ScheduleStatus, string> = {
  manual: "This schedule isn’t armed: the room runs on Today’s targets.",
  draft: "This schedule isn’t armed: the room runs on Today’s targets.",
  armed: "Armed: it takes over from Today’s targets at the next lights-on.",
  active: "Running: each lights-on, the room’s targets for the day come from this schedule.",
  disarming: "Disarming: Today’s targets take back over at the next lights-on.",
  error: "It’s holding its zones until it’s cleared: they get only emergency and watchdog shots.",
};

/** The days of its schedule a room's zones are on today, as the integration publishes them: "day
 * 23", "days 21–23", or "" when it says none. */
export function scheduleDays(controller: Controller): string {
  const zones = resolve(controller.states, controller.room.room, "sensor", "strategy_plan")
    ?.attributes.zones;
  const days = [
    ...new Set(
      (Array.isArray(zones) ? zones : [])
        .map((zone) => zone as { day?: unknown; status?: unknown })
        .filter((zone) => zone.status === "active" && typeof zone.day === "number")
        .map((zone) => zone.day as number),
    ),
  ].sort((a, b) => a - b);
  return !days.length
    ? ""
    : days.length === 1
      ? `day ${days[0]}`
      : `days ${days[0]}–${days.at(-1)}`;
}

/** Which targets the room runs on, said the same way on Today and on Schedule, and told apart at
 * a glance: a running schedule in indigo with a calendar, the room's own targets in blue with
 * sliders, a held schedule in red. */
export function TargetsBanner({
  controller,
  status,
  open,
  from = "today",
}: {
  controller: Controller;
  status: ScheduleStatus;
  /** Where its button goes: the Schedule from Today, Today from the Schedule. */
  open?: { label: string; href: string };
  /** On the Schedule, said from there: Today's own words are about "the targets set here". */
  from?: "today" | "schedule";
}) {
  const name = controller.room.room.name;
  const day = scheduleDays(controller);
  const source =
    status === "error"
      ? "held"
      : status === "active" || status === "disarming"
        ? "schedule"
        : "today";
  const Icon =
    source === "held" ? TriangleAlert : source === "schedule" ? CalendarRange : SlidersHorizontal;
  const title =
    source === "held"
      ? "The schedule is holding its zones"
      : source === "schedule"
        ? `The schedule is in charge${day ? `: ${day}` : ""}`
        : "Today’s targets are in charge";
  const note =
    from === "schedule"
      ? SCHEDULE_NOTES[status]
      : (todayMeaning(status) ??
        "No schedule is armed: the room runs on the targets set here, every grow-day, until you change them.");
  return (
    <div
      className="targets-banner"
      data-source={source}
      data-schedule-status={status}
      role="status"
    >
      <span className="targets-banner-icon" aria-hidden="true">
        <Icon size={20} />
      </span>
      <span className="targets-banner-text">
        <strong>
          {name} · {title}
        </strong>
        <span>{note}</span>
      </span>
      {open && (
        <Button asChild variant="outline" className="targets-banner-action">
          <a href={open.href}>{open.label}</a>
        </Button>
      )}
    </div>
  );
}
