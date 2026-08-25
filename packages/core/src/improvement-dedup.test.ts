import { describe, expect, it } from "vitest";
import type { ImprovementStatus } from "./types";
import {
  IMPROVEMENT_DUPLICATE_THRESHOLD,
  findDuplicateImprovement,
  titleSimilarity,
} from "./improvement-dedup";

/**
 * Near-duplicate detection for the nightly triage (#767, story 15).
 *
 * The cases that matter are the two mistakes it can make. Attaching a real
 * problem to an unrelated item hides it where nobody looks; filing a second
 * item about one problem leaves somebody a merge. The threshold is set for the
 * second, so the tests are mostly about *not* matching.
 */

const item = (
  id: string,
  title: string,
  status: ImprovementStatus = "to_do"
) => ({ id, title, status });

describe("titleSimilarity", () => {
  it("is 1 for the same significant words in any order", () => {
    expect(
      titleSimilarity("Refund policy for cancelled orders", "cancelled orders refund policy")
    ).toBe(1);
  });

  it("ignores the filler that stopwords cover", () => {
    // Same question, asked twice with different padding. None of the padding is
    // a significant word, so the score does not move at all.
    expect(
      titleSimilarity("How do I reset my password", "How to reset the password")
    ).toBe(1);
  });

  it("does not reach for a paraphrase, and that is the accepted limit", () => {
    // "tell" is a real word to this comparison, and two significant words
    // against three is 0.8. Below the bar, so this pair files two items and
    // somebody merges them. Overlap is not meaning, and the threshold is set
    // where a wrong merge is rarer than a wrong split.
    expect(
      titleSimilarity(
        "How do I reset my password",
        "Please tell me how to reset the password"
      )
    ).toBeLessThan(IMPROVEMENT_DUPLICATE_THRESHOLD);
  });

  it("scores a restatement of the same problem above the bar", () => {
    expect(
      titleSimilarity(
        "Password reset link expired",
        "The password reset link expires immediately"
      )
    ).toBeGreaterThanOrEqual(IMPROVEMENT_DUPLICATE_THRESHOLD);
  });

  it("keeps a number significant, so two order numbers are two problems", () => {
    // The known limit stated as a test: this is word overlap, and the bar is
    // set so that one differing word in five is still two items.
    expect(
      titleSimilarity("Order 12345 never arrived", "Order 67890 never arrived")
    ).toBeLessThan(IMPROVEMENT_DUPLICATE_THRESHOLD);
  });

  it("is 0 for titles with nothing significant in common", () => {
    expect(
      titleSimilarity("Refund policy for cancelled orders", "Library opening hours")
    ).toBe(0);
  });

  it("is 0 when a title has no significant words at all", () => {
    expect(titleSimilarity("How do I?", "Refund policy")).toBe(0);
  });
});

describe("findDuplicateImprovement", () => {
  it("finds the open item a restatement belongs on", () => {
    const found = findDuplicateImprovement("Password reset link expired", [
      item("i-1", "Library opening hours"),
      item("i-2", "The password reset link expires immediately"),
    ]);
    expect(found?.id).toBe("i-2");
  });

  it("returns the closest match, not the first over the line", () => {
    const found = findDuplicateImprovement("Refund policy for cancelled orders", [
      item("i-1", "Refund policy questions"),
      item("i-2", "Refund policy for cancelled orders"),
    ]);
    expect(found?.id).toBe("i-2");
  });

  it("ignores closed items: a recurrence deserves its own item", () => {
    // The same rule the conversation-scoped walk uses. Reopening history
    // silently is worse than filing a fresh item on a solved problem.
    expect(
      findDuplicateImprovement("Password reset link expired", [
        item("i-1", "Password reset link expired", "done"),
        item("i-2", "Password reset link expired", "archived"),
      ])
    ).toBeNull();
  });

  it("does not match two different problems that share one word", () => {
    expect(
      findDuplicateImprovement("Refund policy for cancelled orders", [
        item("i-1", "Refund request form is broken on mobile Safari"),
      ])
    ).toBeNull();
  });

  it("is null against an empty board", () => {
    expect(findDuplicateImprovement("Anything", [])).toBeNull();
  });
});

describe("negation is not filler here", () => {
  it("does not merge a sentence with its own negation", () => {
    // `no` is a stopword for the deterministic router, which is right for
    // "which flow is this" and catastrophic for "is this the same problem":
    // dropping it made these two titles identical. Overlap alone still scores
    // them high, so polarity is a gate rather than a term in the score.
    expect(
      findDuplicateImprovement("Search returns no results", [
        item("i-1", "Search returns results"),
      ])
    ).toBeNull();
  });

  it("holds in Italian too, since the stopword list is bilingual", () => {
    expect(
      findDuplicateImprovement("La ricerca non trova risultati", [
        item("i-1", "La ricerca trova risultati"),
      ])
    ).toBeNull();
  });

  it("still merges two reports that are negative in the same way", () => {
    expect(
      findDuplicateImprovement("Search returns no results", [
        item("i-1", "The search returns no results"),
      ])?.id
    ).toBe("i-1");
  });
});
