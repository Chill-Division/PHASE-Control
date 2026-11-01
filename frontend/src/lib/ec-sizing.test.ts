import { describe, expect, it } from "vitest";
import { ecSized, ecSizedWords, readEcSizing, type EcSizing } from "./ec-sizing";

const n = (value: number) => String(Math.round(value * 100) / 100);
// GR1, 2 Nov 2026: EC 0.62 against a P1 target of 5 and a P2 target of 6 halves both.
const gr1: EcSizing = { ec: 0.62, P1: { target: 5, scale: 0.5 }, P2: { target: 6, scale: 0.5 } };

describe("how pore EC sizes a zone's shots", () => {
  it("reads what the controller publishes, and nothing from anything else", () => {
    expect(readEcSizing(gr1)).toEqual(gr1);
    expect(readEcSizing(null)).toBeNull();
    expect(readEcSizing({ ec: 0.62, P1: { target: 5, scale: 0.5 } })).toBeNull();
    expect(readEcSizing({ ...gr1, ec: "0.62" })).toBeNull();
    expect(readEcSizing({ ...gr1, P2: { target: 6, scale: 0 } })).toBeNull();
  });
  it("says nothing of a phase whose shots go in as set", () => {
    expect(ecSized({ ...gr1, P2: { target: 6, scale: 1 } }, "P2")).toBeNull();
    expect(ecSized(null, "P1")).toBeNull();
    expect(ecSized(gr1, "P1")).toMatchObject({ where: "under half", goes: "halved", scale: 0.5 });
  });
  it("puts beside each shot size the size it goes in at", () => {
    expect(ecSizedWords("p1_initial_shot_size", 5, gr1, n, "≈ 80 mL a plant, 1 min 12 s")).toBe(
      "Root-zone EC reads 0.62, under half its P1 target of 5, so ramp shots go in halved: the first at 2.5%, ≈ 80 mL a plant, 1 min 12 s.",
    );
    expect(ecSizedWords("p1_shot_size_increment", 0.5, gr1, n)).toBe(
      "Ramp shots go in halved while root-zone EC reads under half its P1 target, so each adds 0.25%.",
    );
    expect(ecSizedWords("p2_shot_size", 5, gr1, n)).toBe(
      "Root-zone EC reads 0.62, under half its P2 target of 6, so maintenance shots go in halved: 2.5%.",
    );
  });
  it("says a shot made bigger to dilute too", () => {
    const salty: EcSizing = { ec: 8, P1: { target: 5, scale: 2 }, P2: { target: 6, scale: 1.2 } };
    expect(ecSizedWords("p1_initial_shot_size", 5, salty, n)).toBe(
      "Root-zone EC reads 8, over 1.5 times its P1 target of 5, so ramp shots go in doubled, to dilute: the first at 10%.",
    );
    expect(ecSizedWords("p2_shot_size", 5, salty, n)).toBe(
      "Root-zone EC reads 8, over its P2 target of 6, so maintenance shots go in 1.2 times bigger, to dilute: 6%.",
    );
  });
  it("leaves every other setting, and a size not set, alone", () => {
    expect(ecSizedWords("p3_emergency_shot_size", 3, gr1, n)).toBeNull();
    expect(ecSizedWords("p1_initial_shot_size", null, gr1, n)).toBeNull();
    expect(ecSizedWords("p1_initial_shot_size", 5, null, n)).toBeNull();
  });
});
