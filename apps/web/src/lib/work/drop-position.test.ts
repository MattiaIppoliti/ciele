import { describe, expect, it } from "vitest";
import { dropPosition, isNoOpDrop, stepPosition } from "./drop-position";

const order = ["a", "b", "c", "d"];

describe("dropPosition", () => {
  it("puts a Task above or below the one it fell on", () => {
    expect(dropPosition(order, "d", "b", "top")).toEqual({ afterId: "a", beforeId: "b" });
    expect(dropPosition(order, "d", "b", "bottom")).toEqual({ afterId: "b", beforeId: "c" });
    expect(dropPosition(order, "c", "a", "top")).toEqual({ afterId: null, beforeId: "a" });
  });

  it("skips the moving Task when it counts neighbours", () => {
    expect(dropPosition(order, "b", "c", "top")).toEqual({ afterId: "a", beforeId: "c" });
    expect(dropPosition(order, "c", "b", "bottom")).toEqual({ afterId: "b", beforeId: "d" });
  });

  it("sends a drop on the column itself to the end", () => {
    expect(dropPosition(order, "a", null, null)).toEqual({ afterId: "d", beforeId: null });
    expect(dropPosition([], "x", null, null)).toEqual({ afterId: null, beforeId: null });
  });

  it("recognises a drop that moves nothing", () => {
    expect(isNoOpDrop(order, "b", dropPosition(order, "b", "a", "bottom"))).toBe(true);
    expect(isNoOpDrop(order, "b", dropPosition(order, "b", "c", "bottom"))).toBe(false);
  });
});

describe("stepPosition", () => {
  it("moves one place up or down, as a drop on the neighbour would", () => {
    expect(stepPosition(order, "c", -1)).toEqual({ afterId: "a", beforeId: "b" });
    expect(stepPosition(order, "b", 1)).toEqual({ afterId: "c", beforeId: "d" });
    expect(stepPosition(order, "b", -1)).toEqual({ afterId: null, beforeId: "a" });
    expect(stepPosition(order, "c", 1)).toEqual({ afterId: "d", beforeId: null });
  });

  it("stops at either end and for a Task not in the order", () => {
    expect(stepPosition(order, "a", -1)).toBeNull();
    expect(stepPosition(order, "d", 1)).toBeNull();
    expect(stepPosition(order, "x", 1)).toBeNull();
  });
});
