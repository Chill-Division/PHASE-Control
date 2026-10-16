import { DOSER_KEYS } from "./feed";
import { PLUMBING_LABELS, isPlumbingLayout } from "./plumbing";

/** What each mapping is called in a saved setup change: the integration's HARDWARE_WORDS
 * (setup_api.py), which its logbook entry uses. */
export const HARDWARE_WORDS: Record<string, string> = {
  pump_switch: "pump",
  main_line_switch: "main-line valve",
  reservoir_distance_sensor: "reservoir level sensor",
  fresh_water_switch: "fresh-water solenoid",
  recirc_switch: "recirculation solenoid",
  ...Object.fromEntries(DOSER_KEYS.map((key, i) => [key, `doser ${i + 1}`])),
};
/** The same for a zone's fields (ZONE_WORDS). */
export const ZONE_WORDS: Record<string, string> = {
  valve: "valve",
  vwc_sensors: "moisture probes",
  ec_sensors: "EC probes",
  plant_count: "plants",
  substrate_volume: "pot volume (L)",
  drippers_per_plant: "drippers per plant",
  dripper_flow_rate: "dripper flow (L/h)",
};

/** A room as the integration's setup_room gives it, or as the setup page will save it. */
export interface ChangedRoom {
  room_name?: string;
  active?: boolean;
  plumbing?: string;
  hardware?: object;
  zones?: { id: number; name?: string; active?: boolean }[];
}
const field = (from: object | undefined, key: string) =>
  (from as Record<string, unknown> | undefined)?.[key];

/** A value as the logbook says it (setup_api._said): a list joined, a number in at most six
 * significant figures, nothing as "none". */
function said(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ") || "none";
  if (typeof value === "number") return String(Number(value.toPrecision(6)));
  return value ? String(value) : "none";
}

/** What saving `now` over `old` changes, in the words Home Assistant's logbook records it in
 * (setup_api.setup_changes), so the review before a save lists what Activity shows after it. */
export function setupChanges(old: ChangedRoom, now: ChangedRoom): string[] {
  const out: string[] = [];
  if (old.room_name !== now.room_name) out.push(`renamed from “${old.room_name}”`);
  if ((old.active ?? true) !== (now.active ?? true))
    out.push((now.active ?? true) ? "restored" : "archived");
  if (old.plumbing !== now.plumbing) {
    const layout = now.plumbing;
    const label = isPlumbingLayout(layout)
      ? PLUMBING_LABELS[layout].charAt(0).toLowerCase() + PLUMBING_LABELS[layout].slice(1)
      : layout || "none";
    out.push(`plumbing: ${label}`);
  }
  for (const [key, word] of Object.entries(HARDWARE_WORDS)) {
    const was = said(field(old.hardware, key)),
      is = said(field(now.hardware, key));
    if (was !== is) out.push(`${word} ${was} → ${is}`);
  }
  const shown = new Map((old.zones ?? []).map((zone) => [zone.id, zone]));
  for (const zone of now.zones ?? []) {
    const z = zone.id,
      prior = shown.get(z);
    if (!prior) {
      out.push(`zone ${z} added`);
      continue;
    }
    if ((prior.active ?? true) !== (zone.active ?? true))
      out.push(`zone ${z} ${(zone.active ?? true) ? "restored" : "archived"}`);
    if (prior.name !== zone.name)
      out.push(`zone ${z} renamed from “${prior.name}” to “${zone.name}”`);
    for (const [key, word] of Object.entries(ZONE_WORDS)) {
      const was = said(field(prior, key)),
        is = said(field(zone, key));
      if (was !== is) out.push(`zone ${z} ${word} ${was} → ${is}`);
    }
  }
  return out;
}
