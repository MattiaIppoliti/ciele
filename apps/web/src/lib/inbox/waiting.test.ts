import { describe, expect, it } from "vitest";
import { waitedLabel } from "./waiting";

describe("waitedLabel", () => {
  it("says how long a Visitor has waited", () => {
    expect(waitedLabel(20_000)).toBe("Waiting less than a minute");
    expect(waitedLabel(3 * 60_000 + 5_000)).toBe("Waiting 3 min");
    expect(waitedLabel(75 * 60_000)).toBe("Waiting 1 h 15 min");
    expect(waitedLabel(-5)).toBe("Waiting less than a minute");
  });
});
