import { describe, expect, it } from "vitest";
import { reconcileTableOrder, moveTableItem, moveTableColumn, TableViewHistory, tableRangeContains, tableRangeSize } from "./table-view";

describe("table drag ordering", () => {
  it("moves in both directions without losing row identities or mutating input", () => {
    const rows = ["a", "b", "c"];
    expect(moveTableItem(rows, "a", "c")).toEqual(["b", "c", "a"]);
    expect(moveTableItem(rows, "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveTableItem(rows, "gone", "a")).toEqual(rows);
    expect(rows).toEqual(["a", "b", "c"]);
  });
  it("keeps checkboxes, actions and any fixed intermediate column in their slots", () => {
    const columns = [0, 1, 2, 3, 4, 5];
    expect(moveTableColumn(columns, 1, 4, [0, 3, 5])).toEqual([0, 2, 4, 3, 1, 5]);
    expect(moveTableColumn(columns, 1, 5, [0, 5])).toEqual(columns);
    expect(moveTableColumn(columns, 0, 2, [0, 5])).toEqual(columns);
  });
});

describe("table view history", () => {
  it("undoes and redoes interleaved edits in order, and discards redo after a new edit", () => {
    const history = new TableViewHistory();
    const state = { width: 200, row: "a" };
    state.width = 240;
    history.record({ label: "Resize", undo: () => { state.width = 200; }, redo: () => { state.width = 240; } });
    state.row = "b";
    history.record({ label: "Move", undo: () => { state.row = "a"; }, redo: () => { state.row = "b"; } });
    history.undo();
    expect(state).toEqual({ width: 240, row: "a" });
    history.undo();
    expect(state.width).toBe(200);
    history.redo();
    expect(state.width).toBe(240);
    expect(history.redoLabel).toBe("Move");
    history.record({ label: "Filter", undo: () => {}, redo: () => {} });
    expect(history.redoLabel).toBeUndefined();
  });
  it("bounds history and makes empty undo and redo harmless", () => {
    const history = new TableViewHistory();
    history.undo(); history.redo();
    let count = 0;
    for (let i = 0; i < 60; i++) history.record({ label: "Change", undo: () => { count++; }, redo: () => {} });
    for (let i = 0; i < 60; i++) history.undo();
    expect(count).toBe(50);
  });
});

it("selects the same rectangle in either drag direction, including both boundaries", () => {
  const range = { anchor: { row: 3, column: 4 }, focus: { row: 1, column: 2 } };
  expect(tableRangeSize(range)).toBe(9);
  expect(tableRangeContains(range, { row: 2, column: 3 })).toBe(true);
  expect(tableRangeContains(range, { row: 3, column: 4 })).toBe(true);
  expect(tableRangeContains(range, { row: 0, column: 3 })).toBe(false);
  expect(tableRangeContains(null, { row: 1, column: 2 })).toBe(false);
  expect(tableRangeSize(null)).toBe(0);
});

it("reconciles browser ordering after filtering, deletion and arrival of new rows", () => {
  expect(reconcileTableOrder(["c", "gone", "a"], ["a", "b", "c"])).toEqual(["c", "a", "b"]);
  expect(reconcileTableOrder(["c", "a"], ["a", "b"])).toEqual(["a", "b"]);
});
