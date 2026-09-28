import { describe, expect, it } from "vitest";
import { ROLL_ENTRANCE_ROWS, rollsInAt } from "./roll-in-text";

describe("rollsInAt", () => {
  it("rolls the first ten rows in and renders the rest plainly", () => {
    expect(ROLL_ENTRANCE_ROWS).toBe(10);
    expect(rollsInAt(0)).toBe(true);
    expect(rollsInAt(9)).toBe(true);
    expect(rollsInAt(10)).toBe(false);
    expect(rollsInAt(250)).toBe(false);
  });
});
