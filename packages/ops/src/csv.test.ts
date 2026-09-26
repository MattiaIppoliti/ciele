import { describe, expect, it } from "vitest";
import { parseCsv, recordsToCsv, tableToCsv } from "./csv";

describe("tableToCsv", () => {
  it("writes a header row and one line per row, quoting only where needed", () => {
    expect(tableToCsv(["name", "note"], [["Ada", "plain"], ["Bob", 'said "hi", then left']])).toBe(
      'name,note\nAda,plain\nBob,"said ""hi"", then left"',
    );
  });

  it("round-trips embedded commas, quotes and newlines through parseCsv", () => {
    const rows = [["a,b", 'q"q', "line\nbreak"]];
    expect(parseCsv(tableToCsv(["x", "y", "z"], rows))).toEqual([["x", "y", "z"], ...rows]);
  });

  it("renders null and undefined as empty cells and numbers as themselves", () => {
    expect(tableToCsv(["a", "b", "c"], [[null, undefined, -3]])).toBe("a,b,c\n,,-3");
  });

  it.each(["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\tlead", "\rlead"])(
    "neutralises a text cell a spreadsheet would run as a formula: %j",
    (value) => {
      const [, [cell]] = parseCsv(tableToCsv(["v"], [[value]]));
      expect(cell).toBe(`'${value}`);
    },
  );

  it("leaves numbers alone, so a negative figure stays a number", () => {
    expect(tableToCsv(["delta"], [[-12]])).toBe("delta\n-12");
  });
});

describe("recordsToCsv", () => {
  it("takes its columns from the first record", () => {
    expect(recordsToCsv([{ id: "c1", n: 2 }, { id: "c2", n: 3 }])).toBe("id,n\nc1,2\nc2,3");
  });

  it("still writes a header when there are no records, if the columns are given", () => {
    expect(recordsToCsv([], ["id", "title"])).toBe("id,title");
  });
});
