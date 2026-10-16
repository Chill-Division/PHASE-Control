import { describe, expect, it } from "vitest";
import type { DayTrace, GrowDay } from "./day-timeline";
import { weekDays, weekFindings } from "./zone-week";

const H = 3_600_000;
const start = new Date(2026, 8, 14, 6).getTime();
const dayAt = (k: number): GrowDay => ({
  start: start + k * 24 * H,
  lightsOff: start + k * 24 * H + 12 * H,
  end: start + (k + 1) * 24 * H,
});
/** A day that peaks at `peak` `peakAt` hours after lights-on and ends at `end`. */
function trace(k: number, peak: number, peakAt: number, end: number, shots: number): DayTrace {
  const day = dayAt(k);
  const points = [
    { hour: 0, value: 48 },
    { hour: peakAt, value: peak },
    { hour: 12, value: peak - 4 },
    { hour: 23.9, value: end },
  ].map((point) => ({ ...point, time: day.start + point.hour * H }));
  const list = Array.from({ length: shots }, (_, i) => ({
    start: day.start + (1 + i * 0.5) * H,
    end: day.start + (1 + i * 0.5) * H + 60_000,
    open: false,
    phase: "P1",
    reason: null,
  }));
  return { day, points, gaps: [], shots: list };
}

describe("a zone's week", () => {
  it("reads each day's peak while the lights are on and its overnight dryback from it", () => {
    // Traces come latest first, as the timeline loads them; the week reads oldest first.
    const days = weekDays(null, [trace(1, 60, 3.5, 45, 8), null, trace(0, 64, 3, 48, 9)]);
    expect(days.map((day) => day.peak?.value)).toEqual([64, 60]);
    expect(days[0].dryback).toBeCloseTo(25, 5);
    expect(days[1].dryback).toBeCloseTo(25, 5);
    expect(days.map((day) => day.shots)).toEqual([9, 8]);
  });
  it("says today's day so far, with no overnight dryback yet", () => {
    const day = dayAt(2);
    const days = weekDays(
      {
        day,
        points: [
          { time: day.start, value: 47 },
          { time: day.start + 3 * H, value: 63 },
        ],
        shots: [],
      },
      [trace(1, 64, 3, 48, 9)],
    );
    expect(days.at(-1)).toMatchObject({ today: true, dryback: null, peak: { value: 63, hour: 3 } });
  });
  it("finds the dryback against its target, the peak drifting later, and the shots a day", () => {
    const days = weekDays(null, [
      trace(2, 64, 4, 48, 11),
      trace(1, 64, 3.5, 47, 9),
      trace(0, 64, 3, 48, 9),
    ]);
    const found = weekFindings(days, 25);
    expect(found[0]).toEqual({
      tone: "good",
      text: expect.stringMatching(
        /^Overnight dryback averaged 26% over the last 3 grow-days, on its 25% target\.$/,
      ),
    });
    expect(found[1].tone).toBe("warn");
    expect(found[1].text).toMatch(/^The peak came 60 minutes later by the end of the week/);
    expect(found[2]).toEqual({ tone: "info", text: "9 to 11 shots a day, 10 on average." });
  });
  it("says a dryback well off its target", () => {
    const found = weekFindings(weekDays(null, [trace(0, 64, 3, 54, 9)]), 25);
    expect(found[0]).toEqual({
      tone: "warn",
      text: "Overnight dryback averaged 16% over the last 1 grow-day, 9 points short of its 25% target.",
    });
  });
  it("says nothing about days that were not recorded", () => {
    expect(weekFindings(weekDays(null, [null, null]), 25)).toEqual([]);
  });
});
