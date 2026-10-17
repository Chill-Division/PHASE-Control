import { descriptor, numeric, resolve, roomActiveId, roomIsActive } from "./model";
import { growDay } from "./day-timeline";
import type { Change, Room, States } from "./types";

/** How a room runs, in one choice instead of two switches: Steering (the room on and its watering
 * on), Watching only (on, but its engine switch off: the probes are read and the phases followed,
 * no valve opens) or Room off (nothing growing). Null: its switches can't be read. */
export type RoomMode = "steering" | "watching" | "off";

export const MODE_WORDS: Record<RoomMode, { label: string; text: string }> = {
  steering: { label: "Steering", text: "Waters each zone by its targets: the normal way to run." },
  watching: {
    label: "Watching only",
    text: "Reads the probes and follows the phases, but opens no valve: for maintenance, or a flush by hand. Not an emergency stop.",
  },
  off: {
    label: "Room off",
    text: "Nothing growing: no watering and no alerts. Back on within a day, it carries on where it was; after longer, a fresh run starts.",
  },
};

/** The room's engine switch, as the controller reports it, else as setup recorded it. */
export function engineFlag(states: States, room: Room): string | null {
  const beat = resolve(states, room, "sensor", "ai_heartbeat");
  const flag = beat?.attributes.enable_flag ?? descriptor(states, room)?.attributes.enable_flag;
  return typeof flag === "string" && /^(switch|input_boolean)\./.test(flag) ? flag : null;
}

export interface ModeState {
  mode: RoomMode | null;
  /** The room's on/off switch; null on a room without one (it is then always on). */
  roomActiveEntity: string | null;
  engineEntity: string | null;
  engineOn: boolean | null;
}

export function roomMode(states: States, room: Room): ModeState {
  const activeId = roomActiveId(room);
  const roomActiveEntity = states[activeId] ? activeId : null;
  const engineEntity = engineFlag(states, room);
  const engine = engineEntity ? states[engineEntity]?.state : undefined;
  const engineOn = engine === "on" ? true : engine === "off" ? false : null;
  const mode: RoomMode | null = !roomIsActive(states, room)
    ? "off"
    : engineOn === true
      ? "steering"
      : engineOn === false
        ? "watching"
        : null;
  return { mode, roomActiveEntity, engineEntity, engineOn };
}

/** The writes that take a room from how it runs now to `target`, with their before and after. */
export function modeChanges(
  state: ModeState,
  target: RoomMode,
  name: string,
): { change: Change; label: string; before: string; after: string }[] {
  const items: { change: Change; label: string; before: string; after: string }[] = [];
  const roomOn = state.mode !== "off";
  if (target === "off") {
    if (roomOn && state.roomActiveEntity)
      items.push({
        change: { entityId: state.roomActiveEntity, value: false },
        label: `${name} room`,
        before: "On",
        after: "Off",
      });
    return items;
  }
  if (!roomOn && state.roomActiveEntity)
    items.push({
      change: { entityId: state.roomActiveEntity, value: true },
      label: `${name} room`,
      before: "Off",
      after: "On",
    });
  const wantOn = target === "steering";
  if (state.engineEntity && state.engineOn !== wantOn)
    items.push({
      change: { entityId: state.engineEntity, value: wantOn },
      label: `${name} watering`,
      before: state.engineOn ? "On" : state.engineOn === false ? "Off" : "Unknown",
      after: wantOn ? "On" : "Off",
    });
  return items;
}

/** A room's clock as its states give it, without history: the lights and each zone's phase now. */
export function roomClock(states: States, room: Room, now: number) {
  const prefix = room.prefix;
  const on = numeric(states[`number.crop_steering_${prefix}lights_on_hour`]);
  const off = numeric(states[`number.crop_steering_${prefix}lights_off_hour`]);
  const day = growDay(on, off, now);
  const config = descriptor(states, room);
  const ids = Array.isArray(config?.attributes.active_zone_ids)
    ? (config!.attributes.active_zone_ids as unknown[]).filter(
        (id): id is number => typeof id === "number",
      )
    : Array.from({ length: Number(config?.attributes.num_zones) || 0 }, (_, i) => i + 1);
  const names = (config?.attributes.zone_names ?? {}) as Record<string, unknown>;
  return {
    day,
    lightsOn: on,
    hours: day ? (now - day.start) / 3_600_000 : null,
    photoperiod: day ? (day.lightsOff - day.start) / 3_600_000 : null,
    zones: ids.map((id) => ({
      id,
      name: typeof names[id] === "string" ? String(names[id]) : `Zone ${id}`,
      phase: resolve(states, room, "sensor", `zone_${id}_phase`)?.state ?? null,
    })),
  };
}

/** The colour of a zone's ring, line and dot: six blues, in turn. */
export const zoneColor = (index: number) => `var(--zone-${(index % 6) + 1})`;

/** "06:00" from an hour of the day, 6.5 -> "06:30". */
export function hourClock(hour: number | null): string | undefined {
  if (hour === null || !Number.isFinite(hour)) return undefined;
  const minutes = Math.round(hour * 60);
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
