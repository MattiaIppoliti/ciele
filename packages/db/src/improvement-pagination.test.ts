import { describe, expect, it } from "vitest";
import {
  clampPageLimit,
  decodeMemorySubjectCursor,
  finalizeImprovementPage,
  finalizePage,
  normalizeImprovementPageInput,
} from "./improvement-pagination";

describe("improvement pagination", () => {
  it("clamps limits and accepts only safe integer sequence cursors", () => {
    expect(
      normalizeImprovementPageInput({ limit: 500, cursor: "42", status: "done" }),
    ).toEqual({
      limit: 100,
      beforeSeq: 42,
      status: "done",
    });
    expect(normalizeImprovementPageInput({ limit: 0, cursor: "nope" })).toEqual({
      limit: 1,
      beforeSeq: null,
      status: null,
    });
  });

  it("returns a cursor only when another row was fetched", () => {
    expect(finalizeImprovementPage([{ seq: 9 }, { seq: 8 }], 1)).toEqual({
      items: [{ seq: 9 }],
      nextCursor: "9",
    });
    expect(finalizeImprovementPage([{ seq: 9 }], 1)).toEqual({
      items: [{ seq: 9 }],
      nextCursor: null,
    });
  });
});

describe("page helpers", () => {
  it("clamps a page size to 1..100, truncating fractions", () => {
    expect(clampPageLimit(0)).toBe(1);
    expect(clampPageLimit(7.9)).toBe(7);
    expect(clampPageLimit(500)).toBe(100);
  });

  it("names the last item as the cursor only when the extra row came back", () => {
    const id = (row: { id: string }) => row.id;
    expect(finalizePage([{ id: "a" }, { id: "b" }], 1, id)).toEqual({
      items: [{ id: "a" }],
      nextCursor: "a",
    });
    expect(finalizePage([{ id: "a" }], 1, id)).toEqual({
      items: [{ id: "a" }],
      nextCursor: null,
    });
  });

  it("decodes a memory subject cursor or refuses it readably", () => {
    expect(decodeMemorySubjectCursor('["2026-01-01","s1"]')).toEqual([
      "2026-01-01",
      "s1",
    ]);
    for (const bad of ["not json", "null", "[1, 2]"]) {
      expect(() => decodeMemorySubjectCursor(bad)).toThrow(
        "Invalid memory subject cursor",
      );
    }
  });
});
