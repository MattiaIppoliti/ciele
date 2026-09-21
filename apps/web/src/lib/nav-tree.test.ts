import { describe, expect, it } from "vitest";
import { navTreeGeometry, NAV_TREE_PITCH } from "./nav-tree";

describe("navTreeGeometry", () => {
  it("runs the trunk to the last row's bend and no further", () => {
    const { trunk, height } = navTreeGeometry({ count: 3, activeIndex: -1 });
    // Three rows at 34: middles 17, 51, 85; the last bend is 85 - 8.
    expect(trunk.startsWith("M 0.5 0 L 0.5 77 ")).toBe(true);
    // The box is taller than the trunk on purpose: the trunk stops at the
    // elbow, a line past it would point at nothing.
    expect(height).toBe(3 * NAV_TREE_PITCH);
  });

  it("gives every row an elbow, in one path", () => {
    const { trunk } = navTreeGeometry({ count: 3, activeIndex: -1 });
    // One move per elbow plus the trunk's own.
    expect(trunk.match(/M /g)).toHaveLength(4);
    expect(trunk).toContain("Q 0.5 17 8.5 17 L 14 17");
    expect(trunk).toContain("Q 0.5 51 8.5 51 L 14 51");
    expect(trunk).toContain("Q 0.5 85 8.5 85 L 14 85");
  });

  it("draws the active branch as one run from the top", () => {
    const { branch } = navTreeGeometry({ count: 6, activeIndex: 2 });
    // Row 2's middle is 85: trunk to 77, then the bend into it. One subpath,
    // so the corner is a curve rather than two strokes meeting.
    expect(branch).toBe("M 0.5 0 L 0.5 77 Q 0.5 85 8.5 85 L 14 85");
  });

  it("has no branch when nothing in the group is active", () => {
    expect(navTreeGeometry({ count: 4, activeIndex: -1 }).branch).toBeNull();
    // Out of range reads the same way rather than drawing off the bottom.
    expect(navTreeGeometry({ count: 4, activeIndex: 9 }).branch).toBeNull();
  });

  it("draws nothing for an empty group", () => {
    const empty = navTreeGeometry({ count: 0, activeIndex: 0 });
    expect(empty.trunk).toBe("");
    expect(empty.height).toBe(0);
    expect(empty.branch).toBeNull();
  });

  it("follows a different pitch", () => {
    const { trunk } = navTreeGeometry({ count: 2, activeIndex: 0, pitch: 40 });
    expect(trunk).toContain("Q 0.5 20 8.5 20 L 14 20");
    expect(trunk).toContain("Q 0.5 60 8.5 60 L 14 60");
  });
});
