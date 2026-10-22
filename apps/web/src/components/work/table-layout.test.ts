import { describe, expect, it } from "vitest";
import { moveColumn, readColumnLayout, readColumnWidths, writeColumnLayout, writeColumnWidths } from "./table-layout";

const columns = ["status", "priority", "due", "start"] as const;

describe("column layout", () => {
  it("starts from the default order and hidden set", () => {
    const layout = readColumnLayout([], columns, ["start"]);
    expect(layout.order).toEqual(columns);
    expect([...layout.hidden]).toEqual(["start"]);
  });

  it("round-trips order and visibility through one list", () => {
    const layout = readColumnLayout(["due", "-status", "priority", "start"], columns, ["start"]);
    expect(layout.order).toEqual(["due", "status", "priority", "start"]);
    expect([...layout.hidden]).toEqual(["status"]);
    expect(writeColumnLayout(layout)).toEqual(["due", "-status", "priority", "start"]);
  });

  it("drops a removed column and appends an added one with its default", () => {
    const layout = readColumnLayout(["gone", "due", "status"], columns, ["start"]);
    expect(layout.order).toEqual(["due", "status", "priority", "start"]);
    expect([...layout.hidden]).toEqual(["start"]);
  });
});

describe("moveColumn", () => {
  it("moves one place among the visible columns, past hidden ones", () => {
    expect(moveColumn(columns, "due", -1)).toEqual(["status", "due", "priority", "start"]);
    expect(moveColumn(columns, "status", 1, ["status", "due"])).toEqual(["priority", "due", "status", "start"]);
  });

  it("stays put at either end", () => {
    expect(moveColumn(columns, "status", -1)).toEqual(columns);
    expect(moveColumn(columns, "start", 1)).toEqual(columns);
  });
});

describe("column widths", () => {
  it("keeps known columns inside the bounds", () => {
    expect(readColumnWidths(["status=140", "due=10", "gone=200", "start=x", "priority=120.4"], columns)).toEqual({
      status: 140,
      priority: 120,
    });
    expect(writeColumnWidths({ status: 140.2 })).toEqual(["status=140"]);
  });
});
