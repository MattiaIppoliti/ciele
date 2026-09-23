import { describe, expect, it } from "vitest";
import { activeSectionId } from "./section-timeline-active";

/** A 900px-tall box whose activation line sits at 30%, scrolled to `remaining`. */
const view = (remaining: number | null) => ({
  line: 270,
  bottom: 900,
  remaining,
});

describe("activeSectionId", () => {
  it("emphasizes the last section whose top crossed the line", () => {
    const sections = [
      { id: "a", top: -400 },
      { id: "b", top: 100 },
      { id: "c", top: 700 },
    ];
    expect(activeSectionId(sections, view(2000))).toBe("b");
  });

  it("falls back to the first section before anything has crossed", () => {
    const sections = [
      { id: "a", top: 400 },
      { id: "b", top: 900 },
    ];
    expect(activeSectionId(sections, view(2000))).toBe("a");
  });

  it("emphasizes the closing section once the scroll runs out", () => {
    // The page bottom is on screen: "Skills" sits at 620, well under the fixed
    // line at 270, and no amount of scrolling will ever lift it there.
    const sections = [
      { id: "tools", top: -200 },
      { id: "data", top: 240 },
      { id: "skills", top: 620 },
    ];
    expect(activeSectionId(sections, view(2000))).toBe("data");
    expect(activeSectionId(sections, view(0))).toBe("skills");
  });

  it("lights the closing sections in order over the final stretch", () => {
    // 200px of travel left: the line has dropped to 700, which "data" has
    // passed and "skills" has not.
    const sections = [
      { id: "data", top: 240 },
      { id: "skills", top: 720 },
    ];
    expect(activeSectionId(sections, view(200))).toBe("data");
    expect(activeSectionId(sections, view(100))).toBe("skills");
  });

  it("never lifts the line above the fixed one mid-page", () => {
    const sections = [
      { id: "a", top: 200 },
      { id: "b", top: 280 },
    ];
    expect(activeSectionId(sections, view(5000))).toBe("a");
  });

  it("leaves the first section lit on a page that does not scroll", () => {
    const sections = [
      { id: "a", top: 120 },
      { id: "b", top: 500 },
    ];
    expect(activeSectionId(sections, view(null))).toBe("a");
  });

  it("has nothing to emphasize with no sections", () => {
    expect(activeSectionId([], view(0))).toBeNull();
  });
});
