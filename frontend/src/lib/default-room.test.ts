import { beforeEach, describe, expect, it, vi } from "vitest";
import { preferredRoomId, rememberRoom, setDefaultRoomChoice } from "./default-room";

const rooms = [
  { id: "room:", prefix: "", name: "Flower 2" },
  { id: "room:f1_", prefix: "f1_", name: "Flower 1" },
];
describe("the room the dashboard opens on", () => {
  beforeEach(() => {
    const kept = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    });
  });
  it("is the first room until a choice is made", () => {
    expect(preferredRoomId(rooms)).toBeUndefined();
  });
  it("is the room chosen, while it exists", () => {
    setDefaultRoomChoice("room:f1_");
    expect(preferredRoomId(rooms)).toBe("room:f1_");
    expect(preferredRoomId(rooms.slice(0, 1))).toBeUndefined();
  });
  it("can be the room looked at last", () => {
    setDefaultRoomChoice("last");
    expect(preferredRoomId(rooms)).toBeUndefined();
    rememberRoom("room:f1_");
    expect(preferredRoomId(rooms)).toBe("room:f1_");
  });
  it("goes back to the first room when the choice is cleared", () => {
    setDefaultRoomChoice("room:f1_");
    setDefaultRoomChoice("");
    expect(preferredRoomId(rooms)).toBeUndefined();
  });
});
