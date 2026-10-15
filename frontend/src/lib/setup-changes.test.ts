import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HARDWARE_WORDS, ZONE_WORDS, setupChanges, type ChangedRoom } from "./setup-changes";

type Patch = Omit<ChangedRoom, "zones"> & { zones?: Record<string, Record<string, unknown>> };
/** The cases the integration's setup_changes is held to (tests/test_setup_changes.py). */
const shared: {
  room: ChangedRoom;
  cases: { what: string; old?: Patch; change: Patch; said: string[] }[];
} = JSON.parse(
  readFileSync(new URL("../../../tests/fixtures/setup_changes.json", import.meta.url), "utf8"),
);
/** As the Python test builds them: each top-level value replaced, each zone's fields set by id. */
function built(base: ChangedRoom, patch: Patch): ChangedRoom {
  const made = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (key !== "zones") {
      Object.assign(made, { [key]: value });
      continue;
    }
    for (const [id, fields] of Object.entries(value as Record<string, object>)) {
      let zone = made.zones!.find((z) => z.id === Number(id));
      if (!zone) {
        zone = { ...structuredClone(base.zones![0]), id: Number(id) };
        made.zones!.push(zone);
      }
      Object.assign(zone, fields);
    }
  }
  return made;
}

describe("a room's saved changes, in words", () => {
  it.each(shared.cases)("$what", ({ old, change, said }) => {
    expect(setupChanges(built(shared.room, old ?? {}), built(shared.room, change))).toEqual(said);
  });

  it("calls each mapping and zone field what the integration's logbook calls it", () => {
    const source = readFileSync(
      new URL("../../../custom_components/crop_steering/setup_api.py", import.meta.url),
      "utf8",
    );
    const table = (name: string) =>
      Object.fromEntries(
        [
          ...new RegExp(`^${name} = \\{([\\s\\S]*?)^\\}`, "m")
            .exec(source)![1]
            .matchAll(/^\s+"(\w+)": "([^"]+)",$/gm),
        ].map((m) => [m[1], m[2]]),
      );
    const dosers = Object.keys(HARDWARE_WORDS).filter((key) => /^doser_\d+_switch$/.test(key));
    expect(source).toContain(
      '**{key: f"doser {number}" for number, key in enumerate(DOSER_KEYS, 1)},',
    );
    expect(dosers.map((key) => HARDWARE_WORDS[key])).toEqual(
      dosers.map((_, i) => `doser ${i + 1}`),
    );
    expect(
      Object.fromEntries(Object.entries(HARDWARE_WORDS).filter(([key]) => !dosers.includes(key))),
    ).toEqual(table("HARDWARE_WORDS"));
    expect(ZONE_WORDS).toEqual(table("ZONE_WORDS"));
  });
});
