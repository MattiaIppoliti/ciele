import { describe, expect, it } from "vitest";

import {
  nodeScreenRects,
  sameFieldRects,
  toViewportRects,
  type FieldNodeInput,
} from "@/lib/flow-canvas-field";

function node(id: string, x: number, y: number, extra: Partial<FieldNodeInput> = {}): FieldNodeInput {
  return {
    id,
    measured: { width: 248, height: 76 },
    internals: { positionAbsolute: { x, y } },
    ...extra,
  };
}

describe("nodeScreenRects", () => {
  it("applies React Flow's transform: world * zoom + pan", () => {
    const [rect] = nodeScreenRects([100, 50, 0.5], [node("trigger", 40, 20)]);
    expect(rect).toEqual({
      id: "trigger",
      parent: null,
      left: 40 * 0.5 + 100,
      top: 20 * 0.5 + 50,
      right: (40 + 248) * 0.5 + 100,
      bottom: (20 + 76) * 0.5 + 50,
    });
  });

  it("skips hidden and unmeasured nodes rather than clearing a hole at their origin", () => {
    const rects = nodeScreenRects(
      [0, 0, 1],
      [
        node("a", 0, 0, { hidden: true }),
        node("b", 0, 0, { measured: {} }),
        node("c", 0, 0, { measured: { width: 248, height: 0 } }),
        node("d", 0, 0),
      ]
    );
    expect(rects.map((rect) => rect.id)).toEqual(["d"]);
  });

  it("keeps only the carried nodes for a footprint", () => {
    const rects = nodeScreenRects(
      [0, 0, 1],
      [node("a", 0, 0), node("b", 300, 0, { dragging: true })],
      true
    );
    expect(rects.map((rect) => rect.id)).toEqual(["b"]);
  });
});

describe("toViewportRects", () => {
  it("shifts root-relative rects by the root's own box", () => {
    const [scene] = nodeScreenRects([0, 0, 1], [node("a", 10, 20)]);
    expect(toViewportRects([scene!], { left: 200, top: 64 })).toEqual([
      { left: 210, top: 84, right: 458, bottom: 160 },
    ]);
  });
});

describe("sameFieldRects", () => {
  it("is true only when every box is where it was", () => {
    const before = nodeScreenRects([0, 0, 1], [node("a", 0, 0), node("b", 300, 0)]);
    expect(sameFieldRects(before, nodeScreenRects([0, 0, 1], [node("a", 0, 0), node("b", 300, 0)]))).toBe(true);
    expect(sameFieldRects(before, nodeScreenRects([1, 0, 1], [node("a", 0, 0), node("b", 300, 0)]))).toBe(false);
    expect(sameFieldRects(before, nodeScreenRects([0, 0, 1], [node("a", 0, 0)]))).toBe(false);
  });
});
