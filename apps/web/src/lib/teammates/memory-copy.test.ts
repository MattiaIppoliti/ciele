import { describe, expect, it } from "vitest";
import {
  historyAuthor,
  historyChangeSummary,
  historyNote,
  revertLabel,
} from "./memory-copy";

/**
 * The history line is story 19's promise rendered as a sentence: a Member can
 * see who changed what about them, and undo it. These are the cases where the
 * obvious rendering would fail them.
 */

const entry = (over: Record<string, unknown> = {}) => ({
  note: "Added their timezone",
  teammateId: "tm-1",
  authorId: "u-1",
  createdAt: "2026-08-23T10:00:00Z",
  bodyBefore: "Something.",
  ...over,
});

describe("historyAuthor", () => {
  it("names the Teammate that wrote it", () => {
    expect(
      historyAuthor({ entry: entry(), teammateNames: { "tm-1": "Nora" } })
    ).toBe("Nora");
  });

  it("says 'You' for the Member's own edit", () => {
    expect(
      historyAuthor({ entry: entry({ teammateId: null }), teammateNames: {} })
    ).toBe("You");
  });

  it("degrades a deleted Teammate to words, never to an id", () => {
    // The entry outlives the Teammate, and "who wrote this about me" is not
    // answered by a short id.
    expect(historyAuthor({ entry: entry(), teammateNames: {} })).toBe(
      "A teammate"
    );
  });
});

describe("historyNote", () => {
  it("falls back rather than rendering an empty line", () => {
    expect(historyNote({ note: "  " })).toBe("No note left");
    expect(historyNote({ note: "Added their timezone" })).toBe(
      "Added their timezone"
    );
  });
});

describe("revertLabel", () => {
  it("says what reverting the first entry actually does", () => {
    // The oldest entry's `bodyBefore` is the empty document, so "Revert" there
    // means "empty this". Saying so beats a surprise.
    expect(revertLabel({ bodyBefore: "" })).toBe("Clear the document");
    expect(revertLabel({ bodyBefore: "Earlier text." })).toBe(
      "Undo this change"
    );
  });
});

describe("historyChangeSummary", () => {
  it("says which way the document moved", () => {
    expect(
      historyChangeSummary({ delta: 42, before: "a", after: "b".repeat(43) })
    ).toBe("+42 characters");
    expect(
      historyChangeSummary({ delta: -8, before: "b".repeat(9), after: "b" })
    ).toBe("-8 characters");
  });

  it("names a rewrite that came out the same length", () => {
    expect(
      historyChangeSummary({ delta: 0, before: "Rome", after: "Roma" })
    ).toBe("Rewritten, same length");
  });

  it("says so when a write changed nothing at all", () => {
    expect(
      historyChangeSummary({ delta: 0, before: "same", after: "same" })
    ).toBe("No change");
  });
});
