import { describe, expect, it } from "vitest";
import { createScrollDetents } from "./scroll-detents";

describe("menu scroll detents", () => {
  it("accumulates small movements from the gesture's starting position", () => {
    const detents = createScrollDetents(200);
    expect(detents.next(220, 0)).toBe(false);
    expect(detents.next(244, 10)).toBe(true);
    expect(detents.next(244, 100)).toBe(false);
    expect(detents.next(288, 110)).toBe(true);
  });

  it("bounds fast flicks without replaying skipped crossings", () => {
    const detents = createScrollDetents(0);
    expect(detents.next(440, 0)).toBe(true);
    expect(detents.next(880, 20)).toBe(false);
    expect(detents.next(881, 100)).toBe(false);
    expect(detents.next(924, 110)).toBe(true);
  });

  it("starts a new row distance when the gesture reverses", () => {
    const detents = createScrollDetents(100);
    expect(detents.next(130, 0)).toBe(false);
    expect(detents.next(110, 100)).toBe(false);
    expect(detents.next(86, 200)).toBe(true);
  });
});
