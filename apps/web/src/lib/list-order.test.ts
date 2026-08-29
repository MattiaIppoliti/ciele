import { describe, expect, it } from "vitest";
import { moveOrderedId, reorderItemsByIds } from "./list-order";

describe("moveOrderedId", () => {
  it("moves the dragged item to the hovered slot", () => {
    expect(moveOrderedId(["human", "assistant", "billing"], "billing", "human")).toEqual([
      "billing",
      "human",
      "assistant",
    ]);
  });

  it("returns the same order for invalid or identical targets", () => {
    const order = ["human", "assistant"];
    expect(moveOrderedId(order, "human", "human")).toBe(order);
    expect(moveOrderedId(order, "missing", "assistant")).toBe(order);
  });
});

describe("reorderItemsByIds", () => {
  it("applies the sortable value order without losing item data", () => {
    const items = [
      { id: "human", label: "Human help" },
      { id: "assistant", label: "Assistant information" },
      { id: "billing", label: "Billing" },
    ];

    expect(
      reorderItemsByIds(items, ["assistant", "billing", "human"])
    ).toEqual([items[1], items[2], items[0]]);
  });

  it("keeps unlisted items at the end and ignores unknown ids", () => {
    const items = [{ id: "human" }, { id: "assistant" }];

    expect(reorderItemsByIds(items, ["missing", "assistant"])).toEqual([
      items[1],
      items[0],
    ]);
  });
});
