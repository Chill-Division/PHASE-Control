import type { Room } from "./types";

/** Which room the dashboard opens on, on this device: a room's id, "last" (the room looked at
 * last) or nothing (the first room, as before there was a choice). A link's ?room= still wins. */
export const DEFAULT_ROOM_KEY = "crop-steering-default-room";
const LAST_ROOM_KEY = "crop-steering-last-room";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // a private window or blocked storage: the first room, as before
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* The choice still applies until the page reloads. */
  }
}

export const defaultRoomChoice = (): string => read(DEFAULT_ROOM_KEY) ?? "";
export const setDefaultRoomChoice = (value: string) => write(DEFAULT_ROOM_KEY, value || null);
export const rememberRoom = (id: string) => write(LAST_ROOM_KEY, id);

/** The room to open on when the link names none, if the choice names one that exists. */
export function preferredRoomId(rooms: readonly Room[]): string | undefined {
  const choice = read(DEFAULT_ROOM_KEY);
  const id = choice === "last" ? read(LAST_ROOM_KEY) : choice;
  return id ? rooms.find((room) => room.id === id)?.id : undefined;
}
