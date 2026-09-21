import { describe, expect, it } from "vitest";
import { assigneeStackGeometry } from "./assignee-stack";

describe("assigneeStackGeometry", () => {
  it("draws every face while the stack fits", () => {
    const geometry = assigneeStackGeometry({ count: 3, max: 5 });
    expect(geometry.shown).toBe(3);
    expect(geometry.rest).toBe(0);
  });

  it("gives the last slot to the badge once the stack overflows", () => {
    // Six in a five-slot row is four faces and a `+2`, never five and a `+1`:
    // the badge stands in for itself as well as the one it displaced.
    const geometry = assigneeStackGeometry({ count: 6, max: 5 });
    expect(geometry.shown).toBe(4);
    expect(geometry.rest).toBe(2);
  });

  it("fills a full row without a badge", () => {
    const geometry = assigneeStackGeometry({ count: 5, max: 5 });
    expect(geometry.shown).toBe(5);
    expect(geometry.rest).toBe(0);
  });

  it("caps the corner at a circle rather than at the panel's 26px", () => {
    // The panel offers 0-26 against a 32px face, so everything past 16 is the
    // same circle. 22 (the block's default) and 26 have to agree.
    expect(assigneeStackGeometry({ count: 1, corner: 22 }).radius).toBe(16);
    expect(assigneeStackGeometry({ count: 1, corner: 26 }).radius).toBe(16);
    expect(assigneeStackGeometry({ count: 1, corner: 6 }).radius).toBe(6);
    expect(assigneeStackGeometry({ count: 1, corner: -4 }).radius).toBe(0);
  });

  it("packs a Grid into one face's square and ignores the overlap", () => {
    const geometry = assigneeStackGeometry({
      count: 9,
      stack: "Grid",
      overlap: 20,
      max: 5,
    });
    expect(geometry.boxSize).toBe(32);
    expect(geometry.faceSize).toBe(15);
    expect(geometry.offset).toBe(0);
    expect(geometry.shown).toBe(3);
    expect(geometry.rest).toBe(6);
    // A Grid corner is clamped against the quarter face, not the whole square.
    expect(geometry.radius).toBe(7.5);
  });

  it("clamps the overlap to the panel's range", () => {
    expect(assigneeStackGeometry({ count: 2, overlap: 40 }).offset).toBe(22);
    expect(assigneeStackGeometry({ count: 2, overlap: -5 }).offset).toBe(0);
  });

  it("draws nothing for an empty stack", () => {
    const geometry = assigneeStackGeometry({ count: 0 });
    expect(geometry.shown).toBe(0);
    expect(geometry.rest).toBe(0);
  });
});
