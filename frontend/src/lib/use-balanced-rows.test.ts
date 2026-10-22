import { describe, expect, it } from "vitest";
import { balancedColumns } from "./use-balanced-rows";

describe("rows as even as they can be", () => {
  it("keeps one row whenever the cards fit it", () => {
    expect(balancedColumns(4, 1320, 280, 20)).toBe(4); // four stock tanks on a wide screen
    expect(balancedColumns(8, 1016, 112, 10)).toBe(8); // the week beside the rooms list
    expect(balancedColumns(3, 1320, 112, 10)).toBe(3); // a zone with three days recorded
  });
  it("evens out the rows when the cards wrap", () => {
    // Owner, 2026-10-22, Feed → Stock beside the rooms list: two and two, not three and one.
    expect(balancedColumns(4, 1016, 280, 20)).toBe(2);
    expect(balancedColumns(6, 1410, 280, 20)).toBe(3); // three and three, not four and two
    expect(balancedColumns(5, 1410, 280, 20)).toBe(3); // three and two, not four and one
    expect(balancedColumns(8, 680, 112, 10)).toBe(4); // the week on a tablet: four and four
    expect(balancedColumns(5, 760, 220, 12)).toBe(3); // the Schedule's weeks: three and two
  });
  it("leaves a phone as many a row as fit", () => {
    expect(balancedColumns(8, 358, 112, 10)).toBe(3); // the week: three, three and two
    expect(balancedColumns(4, 310, 136, 8)).toBe(2); // the dosers: two and two
    expect(balancedColumns(4, 358, 280, 20)).toBe(1); // the stock tanks, one a row
  });
  it("has nothing to say with no cards or no width", () => {
    expect(balancedColumns(0, 1016, 280, 20)).toBeNull();
    expect(balancedColumns(4, 0, 280, 20)).toBeNull();
    expect(balancedColumns(4, 1016, Number.NaN, 20)).toBeNull();
  });
});
