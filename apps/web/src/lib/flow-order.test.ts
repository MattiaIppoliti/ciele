import { describe, expect, it } from "vitest";
import { moveFlowId } from "./flow-order";

describe("moveFlowId", () => {
  it("moves the dragged flow to the hovered priority slot", () => {
    expect(moveFlowId(["human", "assistant", "billing"], "billing", "human")).toEqual([
      "billing",
      "human",
      "assistant",
    ]);
  });

  it("returns the same order for invalid or identical targets", () => {
    const order = ["human", "assistant"];
    expect(moveFlowId(order, "human", "human")).toBe(order);
    expect(moveFlowId(order, "missing", "assistant")).toBe(order);
  });
});
