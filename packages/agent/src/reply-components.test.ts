import { describe, expect, it } from "vitest";
import {
  REPLY_COMPONENT_LIMITS,
  normalizeTable,
  stripNonProps,
} from "./reply-components";

/**
 * The one normalizer every table surface runs: the zod bounds, the server's
 * part builder, the Inbox export's flattening, and the live client's
 * provisional render. It exists because those four had three copies of the
 * squaring rule between them, and the copies had already diverged.
 */
describe("normalizeTable", () => {
  it("squares a ragged grid positionally", () => {
    expect(
      normalizeTable({ columns: ["A", "B", "C"], rows: [["one"], ["a", "b", "c", "x"]] })
    ).toMatchObject({
      columns: ["A", "B", "C"],
      rows: [
        ["one", "", ""],
        ["a", "b", "c"],
      ],
    });
  });

  it("keeps a non-string cell in ITS OWN column instead of shifting the row", () => {
    // The bug this module exists to kill: filtering non-strings first moved
    // every later cell one column to the left, silently misfiling data.
    expect(normalizeTable({ columns: ["A", "B"], rows: [[42, "b"]] })).toMatchObject({
      rows: [["", "b"]],
    });
  });

  it("caps rows and columns rather than trusting the caller", () => {
    const rows = Array.from({ length: REPLY_COMPONENT_LIMITS.tableRows + 5 }, () => ["x"]);
    const columns = Array.from(
      { length: REPLY_COMPONENT_LIMITS.tableColumns + 3 },
      (_column, i) => `c${i}`
    );
    const table = normalizeTable({ columns, rows });
    expect(table?.rows).toHaveLength(REPLY_COMPONENT_LIMITS.tableRows);
    expect(table?.columns).toHaveLength(REPLY_COMPONENT_LIMITS.tableColumns);
  });

  it("caps a long cell", () => {
    const cell = "x".repeat(REPLY_COMPONENT_LIMITS.tableCellChars + 50);
    const table = normalizeTable({ columns: ["A"], rows: [[cell]] });
    expect(table?.rows[0][0]).toHaveLength(REPLY_COMPONENT_LIMITS.tableCellChars);
  });

  it("returns null when there is nothing to draw yet", () => {
    expect(normalizeTable({})).toBeNull();
    expect(normalizeTable({ columns: [] })).toBeNull();
    expect(normalizeTable({ columns: "nope", rows: [] })).toBeNull();
    expect(normalizeTable(undefined)).toBeNull();
  });

  it("accepts a header-only table, which is what a stream shows first", () => {
    expect(normalizeTable({ columns: ["A", "B"] })).toMatchObject({
      columns: ["A", "B"],
      rows: [],
    });
  });

  it("carries title and caption only when they say something", () => {
    expect(normalizeTable({ columns: ["A"], title: "  ", caption: "" })).toMatchObject({
      title: null,
      caption: null,
    });
    expect(normalizeTable({ columns: ["A"], title: " Piani " })).toMatchObject({
      title: "Piani",
    });
  });

  it("pairs a follow-up prompt with its row, and drops the extras", () => {
    // The one thing a markdown table cannot do: a row you can act on.
    const table = normalizeTable({
      columns: ["Piano"],
      rows: [["Base"], ["Pro"]],
      askAbout: ["Dimmi di più su Base", "", "orphan"],
    });
    expect(table?.rows.map((_row, i) => table.askAbout[i])).toEqual([
      "Dimmi di più su Base",
      null,
    ]);
  });
});

describe("stripNonProps", () => {
  it("drops the Simplified-thinking narration from streamed arguments", () => {
    // `progress` rides the same argument JSON the client parses into props, so
    // the narration would otherwise show up as a prop.
    expect(stripNonProps({ progress: "Sto preparando…", columns: ["A"] })).toEqual({
      columns: ["A"],
    });
  });

  it("leaves an object with no narration alone", () => {
    expect(stripNonProps({ columns: ["A"] })).toEqual({ columns: ["A"] });
  });
});
