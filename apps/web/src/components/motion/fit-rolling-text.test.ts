import { describe, expect, it } from "vitest";
import { fitRollingText } from "./fit-rolling-text";

describe("fitRollingText", () => {
  const measure = () => 10;
  it("keeps text that fits and restores it when a column widens", () => {
    expect(fitRollingText("Improvements", 50, measure)).toBe("Impr…");
    expect(fitRollingText("Improvements", 120, measure)).toBe("Improvements");
  });
  it("does not split combined accents or emoji", () => {
    expect(fitRollingText("e\u0301👩‍💻🇮🇹abc", 40, measure)).toBe("e\u0301👩‍💻🇮🇹…");
  });
  it("accounts for variable glyph widths", () => {
    expect(fitRollingText("WiWi", 25, (glyph) => glyph === "W" ? 15 : 5)).toBe("Wi…");
  });
  it("handles hidden and extremely narrow containers", () => {
    expect(fitRollingText("Title", 0, measure)).toBe("");
    expect(fitRollingText("Title", 5, measure)).toBe("");
    expect(fitRollingText("Title", 10, measure)).toBe("…");
    expect(fitRollingText("", 10, measure)).toBe("");
  });
});
