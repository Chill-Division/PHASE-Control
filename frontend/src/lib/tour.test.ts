import { describe, expect, it } from "vitest";
import { createDemo } from "./demo";
import { OperatorDemo } from "./operator-demo";
import { textPieces, tourSteps } from "./tour";
import { readWhatsNew } from "./whats-new";

describe("the first-run tour", () => {
  it("walks Overview, Irrigation plan, Feed and Settings, and ends on how the room runs", () => {
    const steps = tourSteps(true);
    expect(steps.map((step) => step.page)).toEqual([
      null,
      "overview",
      "strategy",
      "reservoir",
      "setup",
      "overview",
    ]);
    expect(steps.at(-1)!.target).toEqual([".mode-pill"]);
    expect(steps[0].target).toEqual([]); // the welcome points at nothing
  });
  it("opens Feed on the stock tanks in a room without a reservoir, as the menu does", () => {
    const feed = tourSteps(false).find((step) => step.id === "feed")!;
    expect(feed.page).toBe("stock");
    expect(feed.text).toMatch(/its \*\*Reservoir\*\* page appears here/);
  });
  it("marks every name it bolds at both ends", () => {
    for (const step of [...tourSteps(true), ...tourSteps(false)])
      expect(textPieces(step.text).length % 2, step.id).toBe(1);
    expect(textPieces("Open **Help** now")).toEqual(["Open ", "Help", " now"]);
  });
  it("starts by itself once in the demo of a new installation, and never in the plain demo", async () => {
    const states = createDemo();
    const fresh = new OperatorDemo(
      () => states,
      () => {},
      null,
      true,
    );
    expect(readWhatsNew(await fresh.call("whats_new_get", {}))?.tour).toBe(true);
    expect(await fresh.call("whats_new_tour_seen", {})).toEqual({ tour: false });
    expect(readWhatsNew(await fresh.call("whats_new_get", {}))?.tour).toBe(false);
    const plain = new OperatorDemo(
      () => states,
      () => {},
    );
    expect(readWhatsNew(await plain.call("whats_new_get", {}))?.tour).toBe(false);
  });
});
