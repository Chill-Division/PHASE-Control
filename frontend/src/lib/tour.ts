import type { Page } from "@/components/dashboard";

/** One stop of the first-run tour: the page it shows and what on it the words are about. */
export interface TourStep {
  id: string;
  /** The page it opens; null stays where it is. */
  page: Page | null;
  title: string;
  /** Plain words; **two asterisks** around a name the page shows. */
  text: string;
  /** What it points at: every element the first of these selectors finds, as one. None: nothing. */
  target: string[];
}

/** The tour: where things are, then how to switch the room on. A room without a reservoir has no
 * Reservoir page: Feed opens on its stock tanks, as the menu does. */
export function tourSteps(reservoir: boolean): TourStep[] {
  return [
    {
      id: "welcome",
      page: null,
      title: "Welcome to PHASE Control",
      text: "It waters this room by itself, from your probes and your setpoints. Here is where everything is, in five stops. Skip it at any time: **Help** starts it again.",
      target: [],
    },
    {
      id: "overview",
      page: "overview",
      title: "Overview",
      text: "The room today: its grow-day on the clock and what comes next, each zone's day with its band from trigger to peak, the reservoir and what has happened. Open a zone for its whole day, every shot and why.",
      target: ["[data-today]"],
    },
    {
      id: "plan",
      page: "strategy",
      title: "Irrigation strategy",
      text: "Where you steer. **Today** sets each zone's targets for the four phases, from the morning dryback to the overnight one. **Schedule** moves them through the grow, more vegetative or more generative, week by week.",
      target: [".section-header .segmented", ".section-title"],
    },
    {
      id: "feed",
      page: reservoir ? "reservoir" : "stock",
      title: "Feed",
      text: reservoir
        ? "For a batch tank the controller looks after: its level and minimum, and the refills it mixes. **Recipes** holds the feed recipes and when each is used; **Stock tanks** keeps track of the concentrates that feed the dosers."
        : "For a batch tank the controller looks after: map its level sensor, solenoids and dosers in **Settings**, and its **Reservoir** page appears here. **Stock tanks** keeps track of the concentrates that feed the dosers.",
      target: [".section-header .segmented", ".section-title"],
    },
    {
      id: "settings",
      page: "setup",
      title: "Settings",
      text: "**Rooms & hardware** holds what this room is wired to: its valves, pump, probes and pot sizes. Its **Tests** give a zone a 10-second test shot, so you can see the water reach the drippers.",
      target: [".section-header .segmented", ".section-title"],
    },
    {
      id: "switch",
      page: "overview",
      title: "Switch it on",
      text: "When the probes read right and a test shot reaches the drippers, switch it on here: **Steering** lets the controller water the room. **Watching only** reads the probes and follows the phases without watering, and **Room off** is for a room with nothing growing. Each choice shows what changes before it applies.",
      target: [".mode-pill"],
    },
  ];
}

/** `text` in pieces, every other one inside two asterisks: [plain, bold, plain, …]. */
export const textPieces = (text: string) => text.split("**");
