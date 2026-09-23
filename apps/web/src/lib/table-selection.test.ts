import { describe, expect, it } from "vitest";
import {
  selectAllState,
  selectForContextMenu,
  selectedRowIds,
  toggleAllRows,
  toggleRow,
} from "./table-selection";

const rows = ["a", "b", "c"];

describe("selectAllState", () => {
  it("is none on an empty table, whatever the set holds", () => {
    // The set outlives a filter, so a table showing nothing can still carry
    // ids. The header box is off, not ticked.
    expect(selectAllState(new Set(["a"]), [])).toBe("none");
  });

  it("reads all only when every row on screen is in the set", () => {
    expect(selectAllState(new Set(rows), rows)).toBe("all");
    expect(selectAllState(new Set(["a", "b"]), rows)).toBe("some");
    expect(selectAllState(new Set(["z"]), rows)).toBe("none");
  });
});

describe("selectedRowIds", () => {
  it("keeps the table's order, not the set's insertion order", () => {
    expect(selectedRowIds(new Set(["c", "a"]), rows)).toEqual(["a", "c"]);
  });

  it("drops ids that are no longer on screen", () => {
    expect(selectedRowIds(new Set(["a", "gone"]), rows)).toEqual(["a"]);
  });
});

describe("toggleRow", () => {
  it("adds then removes, leaving the input untouched", () => {
    const start = new Set<string>();
    const on = toggleRow(start, "a");
    expect([...on]).toEqual(["a"]);
    expect(start.size).toBe(0);
    expect([...toggleRow(on, "a")]).toEqual([]);
  });
});

describe("toggleAllRows", () => {
  it("fills up from a partial selection", () => {
    expect([...toggleAllRows(new Set(["a"]), rows)]).toEqual(rows);
  });

  it("clears only once everything on screen is selected", () => {
    expect([...toggleAllRows(new Set(rows), rows)]).toEqual([]);
  });

  it("leaves off-screen ids alone when it clears", () => {
    // Page 2's header box must not silently drop page 1's selection.
    expect([...toggleAllRows(new Set([...rows, "off"]), rows)]).toEqual(["off"]);
  });
});

describe("selectForContextMenu", () => {
  it("replaces the selection when the row is outside it", () => {
    // Right-clicking a fourth row must not leave the bulk bar claiming three:
    // the menu is titled with one name and acts on one row.
    const next = selectForContextMenu(new Set(["a", "b", "c"]), "d");
    expect([...next]).toEqual(["d"]);
  });

  it("leaves the selection alone when the row is already in it", () => {
    // That gesture means "act on all of these", so narrowing to one would
    // throw away what the reader spent the clicks building.
    const selected = new Set(["a", "b"]);
    expect(selectForContextMenu(selected, "b")).toBe(selected);
  });

  it("selects a row from an empty selection", () => {
    expect([...selectForContextMenu(new Set(), "a")]).toEqual(["a"]);
  });
});
