import { describe, expect, it } from "vitest";
import {
  finalizeImprovementPage,
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
