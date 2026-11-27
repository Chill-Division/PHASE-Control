import { describe, expect, it } from "vitest";
import { drybackWords } from "./dryback-words";

const number = (value: number) => String(Number(value.toFixed(2)));

describe("what a P3 dryback target works out to", () => {
  it("before the day's peak, a plan from the Peak target", () => {
    expect(drybackWords(30, 85.1, [{ name: "Zone 1", phase: "P1", peak: 72 }], false, number)).toBe(
      "30% of the day’s peak: from a 85.1% peak, down to 59.57%.",
    );
    expect(drybackWords(30, NaN, [], false, number)).toBe("30% of the day’s peak.");
  });
  it("once the zone has had its peak, tonight's line from it", () => {
    // GT1-AT, 27 Nov 2026: 99.4% at 10:34, where the card said 59.6% from the 85.1% Peak target.
    expect(
      drybackWords(30, 85.1, [{ name: "GT1-AT", phase: "P3", peak: 99.4 }], false, number),
    ).toBe("30% of the day’s peak. Today’s was 99.4%, so tonight’s line is 69.58%.");
  });
  it("in a room on one valve, each zone's own line, the first to reach its own for them all", () => {
    const zones = [
      { name: "GT1-AT", phase: "P3", peak: 99.4 },
      { name: "GT1-BP", phase: "P3", peak: 86.4 },
    ];
    expect(drybackWords(30, 85.1, zones, true, number)).toBe(
      "30% of each zone’s own peak, and the first zone to reach its own line waters them all. Tonight: GT1-AT 69.58% (from 99.4%), GT1-BP 60.48% (from 86.4%).",
    );
    expect(
      drybackWords(
        30,
        85.1,
        zones.map((zone) => ({ ...zone, phase: "P1" })),
        true,
        number,
      ),
    ).toBe(
      "30% of each zone’s own peak, and the first zone to reach its own line waters them all. From a 85.1% peak, that is 59.57%.",
    );
  });
});
