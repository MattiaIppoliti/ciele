import { describe, expect, it } from "vitest";
import {
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
      columnWidthFor({ pointer: 210, grabOffset: 0, left: 200, minWidth: 40 })
    ).toBe(40);
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
});
