import { describe, expect, it } from "vitest";
import { inAbout, refillByWords, refillEstimate } from "./refill-estimate";

const HOUR = 3_600_000;
const NOW = new Date(2026, 9, 26, 12, 0, 0).getTime(); // a Monday, midday
/** A reading every 5 minutes over the last `hours`, from level(at). */
const record = (level: (at: number) => number, hours = 26) =>
  Array.from({ length: (hours * 60) / 5 + 1 }, (_, n) => {
    const at = NOW - hours * HOUR + n * 5 * 60_000;
    return { at, pct: level(at) };
  });

describe("estimated refill by", () => {
  it("goes by what the last day used: half a point an hour leaves 43 points for 86 hours", () => {
    const steady = record((at) => 48 + ((NOW - at) / HOUR) * 0.5);
    const estimate = refillEstimate(steady, 48, 5, NOW);
    expect(estimate.perDay).toBeCloseTo(12, 0);
    expect(Math.abs(estimate.at! - (NOW + 86 * HOUR))).toBeLessThan(HOUR);
  });

  it("lands in the morning ramp, where a room's water goes", () => {
    // Each morning's ramp, 08:00-10:00, takes 14 points; nothing else does. `used` counts from a
    // week before.
    const week = new Date(2026, 9, 19).getTime();
    const used = (at: number) => {
      const d = new Date(at);
      const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - week) / (24 * HOUR));
      return days * 14 + Math.min(Math.max(d.getHours() + d.getMinutes() / 60 - 8, 0), 2) * 7;
    };
    const levels = record((at) => 20 + used(NOW) - used(at));
    const estimate = refillEstimate(levels, 20, 5, NOW);
    expect(estimate.perDay).toBeCloseTo(14, 0);
    // 15 points left: tomorrow's ramp takes 14, so the day after's takes it to 5%.
    const when = new Date(estimate.at!);
    expect(when.getDate()).toBe(28);
    expect(when.getHours()).toBeGreaterThanOrEqual(8);
    expect(when.getHours()).toBeLessThan(10);
  });

  it("leaves a refill's rise out of what the day used", () => {
    const refilled = NOW - 6 * HOUR; // from 6% to 72% in ten minutes, six hours ago
    const level = (at: number) =>
      at < refilled
        ? 6 + ((refilled - at) / HOUR) * 0.5
        : at < refilled + 10 * 60_000
          ? 6 + (66 * (at - refilled)) / (10 * 60_000)
          : 72 - ((at - refilled - 10 * 60_000) / HOUR) * 0.5;
    const estimate = refillEstimate(record(level), level(NOW), 5, NOW);
    expect(estimate.perDay).toBeGreaterThan(11);
    expect(estimate.perDay).toBeLessThan(13);
  });

  it("is not thrown by a level sensor that reads a point either way", () => {
    let seed = 7;
    const jitter = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280 - 0.5) * 2;
    const noisy = record((at) => 48 + ((NOW - at) / HOUR) * 0.5 + jitter());
    expect(refillEstimate(noisy, 48, 5, NOW).perDay).toBeGreaterThan(10);
    expect(refillEstimate(noisy, 48, 5, NOW).perDay).toBeLessThan(14);
  });

  it("says why when it can't tell", () => {
    const short = record((at) => 48 + ((NOW - at) / HOUR) * 0.5, 10);
    expect(refillEstimate(short, 48, 5, NOW)).toMatchObject({ at: null });
    expect(refillEstimate(short, 48, 5, NOW).reason).toMatch(/a day of recorded level/);
    const unused = record(() => 48);
    expect(refillEstimate(unused, 48, 5, NOW)).toMatchObject({ at: null });
    expect(refillEstimate(unused, 48, 5, NOW).reason).toMatch(/hardly been used/);
    expect(refillEstimate(unused, null, 5, NOW).reason).toMatch(/reads nothing/);
  });

  it("is due now at or under the level, and no more than 30 days out", () => {
    const steady = record((at) => 4 + ((NOW - at) / HOUR) * 0.5);
    expect(refillEstimate(steady, 4, 5, NOW).at).toBe(NOW);
    const slow = record((at) => 80 + ((NOW - at) / HOUR) * (1 / 24));
    expect(refillEstimate(slow, 80, 5, NOW).at).toBe(Infinity);
  });

  it("says it in days and hours", () => {
    expect(refillByWords(NOW + 4 * HOUR, NOW)).toMatch(/^today, around 4/);
    expect(refillByWords(NOW + 21 * HOUR, NOW)).toMatch(/^tomorrow, around 9/);
    expect(refillByWords(NOW + 70 * HOUR, NOW)).toMatch(/, around 10/); // Thursday
    expect(refillByWords(NOW + 10 * 24 * HOUR, NOW)).not.toMatch(/around/);
    expect(refillByWords(Infinity, NOW)).toBe("more than 30 days away");
    expect([7, 26, 36, 60, 86, 200].map((h) => inAbout(h * HOUR))).toEqual([
      "in about 7 hours",
      "in about 1 day",
      "in about 1½ days",
      "in about 2½ days",
      "in about 4 days",
      "in about 8 days",
    ]);
  });
});
