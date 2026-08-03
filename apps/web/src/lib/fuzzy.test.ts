import { describe, expect, it } from "vitest";
import { fuzzyMatch, typoSubsequenceCost } from "./fuzzy";

describe("typoSubsequenceCost", () => {
  it("costs nothing when the needle is a subsequence of the hay", () => {
    expect(typoSubsequenceCost("mrc", "marco iecher")).toBe(0);
    expect(typoSubsequenceCost("", "anything")).toBe(0);
  });

  it("charges one per mistyped or surplus needle character", () => {
    expect(typoSubsequenceCost("marko", "marco")).toBe(1);
    expect(typoSubsequenceCost("marcoo", "marco")).toBe(1);
  });
});

describe("fuzzyMatch", () => {
  it("matches out-of-order-free subsequences", () => {
    expect(fuzzyMatch("mrc", "Marco Iecher")).toBe(true);
    expect(fuzzyMatch("iech", "Marco Iecher")).toBe(true);
  });

  it("is case insensitive and matches everything on an empty needle", () => {
    expect(fuzzyMatch("MARCO", "marco iecher")).toBe(true);
    expect(fuzzyMatch("", "whatever")).toBe(true);
  });

  it("tolerates typos in proportion to the needle's length", () => {
    // <=3 chars: no error budget, so one wrong character rules it out.
    expect(fuzzyMatch("mrx", "Marco Iecher")).toBe(false);
    // 4-6 chars: one typo forgiven.
    expect(fuzzyMatch("marko", "Marco Iecher")).toBe(true);
    // 7+ chars: two.
    expect(fuzzyMatch("martinna binacci", "Martina Binacci")).toBe(true);
  });

  it("still rejects a name the needle cannot reach", () => {
    expect(fuzzyMatch("valeria", "Marco Iecher")).toBe(false);
  });
});
