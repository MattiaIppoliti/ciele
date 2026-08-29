import { describe, expect, it } from "vitest";
import { NO_MATCH, fuzzyFilter, fuzzyMatch, fuzzyScore, typoSubsequenceCost } from "./fuzzy";

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

describe("fuzzyScore", () => {
  it("scores an empty needle as a neutral match", () => {
    expect(fuzzyScore("", "Alex")).toBe(0);
    expect(fuzzyScore("   ", "Alex")).toBe(0);
  });

  it("refuses out-of-order characters", () => {
    expect(fuzzyScore("xela", "Alex")).toBe(NO_MATCH);
  });

  it("ranks word-start matches above scattered ones", () => {
    expect(fuzzyScore("csa", "Ciele Support Assistant")).toBeGreaterThan(
      fuzzyScore("csa", "Cambridge escalation area")
    );
  });

  it("ranks a consecutive run above a split one", () => {
    expect(fuzzyScore("sup", "Support desk")).toBeGreaterThan(
      fuzzyScore("sup", "Sales unit planner")
    );
  });

  it("ignores case and spaces in the needle", () => {
    expect(fuzzyScore("SUP ASS", "Ciele Support Assistant")).toBeGreaterThan(0);
  });
});

describe("fuzzyFilter", () => {
  const assistants = [
    { title: "Alex", nickname: "AlexAI" },
    { title: "Ciele Support Assistant", nickname: "Ciele AI" },
    { title: "Campus Wayfinder", nickname: "Wayfinder" },
  ];
  const text = (a: (typeof assistants)[number]) => `${a.title} ${a.nickname}`;

  it("keeps the original order for an empty needle", () => {
    expect(fuzzyFilter(assistants, "", text).map((a) => a.title)).toEqual([
      "Alex",
      "Ciele Support Assistant",
      "Campus Wayfinder",
    ]);
  });

  it("drops non-matches and ranks the best match first", () => {
    expect(fuzzyFilter(assistants, "supp", text).map((a) => a.title)).toEqual([
      "Ciele Support Assistant",
    ]);
  });

  it("ranks by score, not input order", () => {
    expect(fuzzyFilter(assistants, "ca", text).map((a) => a.title)[0]).toBe(
      "Campus Wayfinder"
    );
  });

  it("keeps a typo'd needle, ranked below the clean matches", () => {
    // "campos" is one typo away from Campus; nothing else comes close.
    expect(fuzzyFilter(assistants, "campos", text).map((a) => a.title)).toEqual([
      "Campus Wayfinder",
    ]);
  });

  it("returns nothing when no item matches", () => {
    expect(fuzzyFilter(assistants, "zzz", text)).toEqual([]);
  });
});
