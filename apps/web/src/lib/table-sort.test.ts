import { describe, expect, it } from "vitest";
import { pageSlice, sortRows } from "./table-sort";

interface Row {
  id: string;
  name: string;
  count: number;
  url: string | null;
}

const rows: Row[] = [
  { id: "1", name: "Zebra", count: 2, url: null },
  { id: "2", name: "apple", count: 10, url: "https://b.example" },
  { id: "3", name: "Mango", count: 2, url: "https://a.example" },
];

const accessors = {
  name: (r: Row) => r.name,
  count: (r: Row) => r.count,
  url: (r: Row) => r.url,
};

const ids = (sort: Parameters<typeof sortRows>[1]) =>
  sortRows(rows, sort, accessors).map((r) => r.id);

describe("sortRows", () => {
  it("keeps the server's order when nothing is sorted", () => {
    expect(ids(null)).toEqual(["1", "2", "3"]);
    expect(ids({ key: "nonexistent", ascending: true })).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("compares text case-insensitively", () => {
    // Byte order would put every capital ahead of "apple".
    expect(ids({ key: "name", ascending: true })).toEqual(["2", "3", "1"]);
    expect(ids({ key: "name", ascending: false })).toEqual(["1", "3", "2"]);
  });

  it("compares numbers as numbers", () => {
    // As strings, "10" sorts before "2".
    expect(ids({ key: "count", ascending: true })[2]).toBe("2");
  });

  it("leaves empty cells at the bottom in both directions", () => {
    expect(ids({ key: "url", ascending: true })).toEqual(["3", "2", "1"]);
    expect(ids({ key: "url", ascending: false })).toEqual(["2", "3", "1"]);
  });

  it("does not mutate the input", () => {
    const before = rows.map((r) => r.id);
    sortRows(rows, { key: "name", ascending: true }, accessors);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe("pageSlice", () => {
  const rows = [1, 2, 3, 4, 5];

  it("cuts the page the reader asked for", () => {
    expect(pageSlice(rows, 2, 2)).toEqual({ items: [3, 4], page: 2 });
  });

  it("clamps a page the set no longer has", () => {
    // A filter that shrinks the set must not strand the reader on page 4.
    expect(pageSlice(rows, 9, 2)).toEqual({ items: [5], page: 3 });
    expect(pageSlice([], 4, 25)).toEqual({ items: [], page: 1 });
  });

  it("clamps a page below one", () => {
    expect(pageSlice(rows, 0, 2).page).toBe(1);
  });
});
