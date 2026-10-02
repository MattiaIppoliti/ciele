import { describe, expect, it } from "vitest";
import {
  fitColumnWidths,
  resolveColumnWidths,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  columnWidthFor,
  columnWidthsKey,
  parseColumnWidths,
} from "./table-columns";

describe("columnWidthFor", () => {
  it("follows the grab point, not the pointer", () => {
    // Grabbed 4px to the right of the border, so a pointer at 504 still means
    // a 500px edge. Without the offset the column would jump by 4 on move one.
    expect(
      columnWidthFor({ pointer: 504, grabOffset: 4, left: 200 })
    ).toBe(300);
  });

  it("clamps rather than resisting at either bound", () => {
    expect(columnWidthFor({ pointer: 0, grabOffset: 0, left: 200 })).toBe(
      MIN_COLUMN_WIDTH
    );
    expect(
      columnWidthFor({ pointer: 99_999, grabOffset: 0, left: 0 })
    ).toBe(MAX_COLUMN_WIDTH);
  });

  it("honours a column's own minimum", () => {
    expect(
      columnWidthFor({ pointer: 210, grabOffset: 0, left: 200, minWidth: 180 })
    ).toBe(180);
  });

  it("returns whole pixels, so the colgroup does not jitter", () => {
    expect(
      columnWidthFor({ pointer: 300.6, grabOffset: 0.2, left: 100 })
    ).toBe(200);
  });
});

describe("parseColumnWidths", () => {
  const keys = ["name", "status"];

  it("survives every shape a browser store can hand back", () => {
    expect(parseColumnWidths(null, keys)).toEqual({});
    expect(parseColumnWidths("not json", keys)).toEqual({});
    expect(parseColumnWidths("42", keys)).toEqual({});
    expect(parseColumnWidths("null", keys)).toEqual({});
  });

  it("drops columns the table no longer has", () => {
    // A release renamed a column; its stored width must not resurrect it.
    expect(
      parseColumnWidths('{"name":200,"gone":300}', keys)
    ).toEqual({ name: 200 });
  });

  it("drops widths outside the bounds a drag could produce", () => {
    expect(
      parseColumnWidths(
        `{"name":${MIN_COLUMN_WIDTH - 1},"status":${MAX_COLUMN_WIDTH + 1}}`,
        keys
      )
    ).toEqual({});
    expect(parseColumnWidths('{"name":"200"}', keys)).toEqual({});
  });

  it("namespaces the key by table", () => {
    expect(columnWidthsKey("library-websites")).toBe(
      "ciele.table-widths.library-websites"
    );
  });
  it("rejects legacy widths below the new readable minimum", () => {
    expect(parseColumnWidths('{"name":40,"status":56}', keys)).toEqual({});
  });
});

describe("fitColumnWidths", () => {
  const columns = [
    { key: "name", width: 380, min: 180 },
    { key: "date", width: 180, min: 140 },
    { key: "actions", width: 88, min: 88, fixed: true },
  ];
  it("fits the available space without expanding actions", () => {
    const widths = fitColumnWidths(columns, 500);
    expect(Object.values(widths).reduce((sum, width) => sum + width, 0)).toBeCloseTo(500);
    expect(widths.actions).toBe(88);
    expect(widths.name).toBeGreaterThanOrEqual(180);
    expect(widths.date).toBeGreaterThanOrEqual(140);
  });
  it("preserves readable floors when horizontal scrolling is necessary", () => {
    expect(fitColumnWidths(columns, 200)).toEqual({ name: 180, date: 140, actions: 88 });
  });
  it("gives spare space to data columns only", () => {
    const widths = fitColumnWidths(columns, 900);
    expect(widths.actions).toBe(88);
    expect(Object.values(widths).reduce((sum, width) => sum + width, 0)).toBeCloseTo(900);
  });
  it("keeps a chosen narrow width after release and puts spare space elsewhere", () => {
    const widths = fitColumnWidths(columns, 900, { name: 40 });
    expect(widths.name).toBe(120);
    expect(widths.date).toBe(692);
    expect(widths.actions).toBe(88);
  });
  it("does not stretch columns when all data widths are chosen", () => {
    expect(fitColumnWidths(columns, 900, { name:40, date:56 })).toEqual({name:120,date:120,actions:88});
  });
});


describe("saved column layouts", () => {
  const columns = [
    { key: "name", width: 380, min: 180 },
    { key: "status", width: 180, min: 140 },
    { key: "actions", width: 88, min: 88, fixed: true },
  ];
  it("keeps neighbors unchanged after shrinking or expanding the middle column", () => {
    const initial = resolveColumnWidths(columns, 900, {});
    for (const status of [140, 600]) {
      const saved = { ...initial, status };
      for (const viewport of [400, 900, 1400]) {
        expect(resolveColumnWidths(columns, viewport, saved)).toEqual(saved);
      }
    }
  });
  it("enforces individual minimum widths on old saved layouts", () => {
    expect(resolveColumnWidths(columns, 900, { name: 72, status: 72 })).toEqual({ name: 180, status: 140, actions: 88 });
  });
});
