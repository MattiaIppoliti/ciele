import { describe, expect, it } from "vitest";
import { NO_MATCH, fuzzyFilter, fuzzyMatch, fuzzyScore, substringMatch, typoSubsequenceCost } from "./fuzzy";

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
  const matches = (needle: string, hay: string) => fuzzyMatch(needle, hay) !== null;

  it("matches out-of-order-free subsequences", () => {
    expect(matches("mrc", "Marco Iecher")).toBe(true);
    expect(matches("iech", "Marco Iecher")).toBe(true);
  });

  it("is case insensitive and matches everything on an empty needle", () => {
    expect(matches("MARCO", "marco iecher")).toBe(true);
    expect(fuzzyMatch("", "whatever")).toEqual([]);
  });

  it("tolerates typos in proportion to the needle's length", () => {
    // <=3 chars: no error budget, so one wrong character rules it out.
    expect(fuzzyMatch("mrx", "Marco Iecher")).toBeNull();
    // 4-6 chars: one typo forgiven.
    expect(matches("marko", "Marco Iecher")).toBe(true);
    // 7+ chars: two.
    expect(matches("martinna binacci", "Martina Binacci")).toBe(true);
  });

  it("still rejects a name the needle cannot reach", () => {
    expect(fuzzyMatch("valeria", "Marco Iecher")).toBeNull();
  });
});

describe("fuzzyMatch ranges (#1072)", () => {
  it("marks a literal run whole, wherever it sits", () => {
    expect(fuzzyMatch("brief", "Write the launch brief")).toEqual([[17, 22]]);
    expect(fuzzyMatch("  Launch ", "Write the launch brief")).toEqual([[10, 16]]);
  });

  it("marks the letters of a subsequence, merged into runs", () => {
    expect(fuzzyMatch("wlb", "Write the launch brief")).toEqual([[0, 1], [10, 11], [17, 18]]);
    expect(fuzzyMatch("web 3", "WEB-3 footer")).toEqual([[0, 3], [4, 5]]);
  });

  it("marks what a typo'd needle got right, not nothing", () => {
    // `k` is the typo: Mar and o are the letters the match stands on.
    expect(fuzzyMatch("marko", "Marco Iecher")).toEqual([[0, 3], [4, 5]]);
    // `o` for `u` marks nothing; Camp and s are marked.
    expect(fuzzyMatch("campos", "Campus Wayfinder")).toEqual([[0, 4], [5, 6]]);
    // A surplus key is dropped, and the rest is one run.
    expect(fuzzyMatch("marcoo", "Marco Iecher")).toEqual([[0, 5]]);
  });

  it("only marks letters that are in the hay, in order", () => {
    for (const [needle, hay] of [
      ["marko", "Marco Iecher"],
      ["martinna binacci", "Martina Binacci"],
      ["supprot", "Ciele Support Assistant"],
    ] as const) {
      const ranges = fuzzyMatch(needle, hay)!;
      let previous = -1;
      for (const [start, end] of ranges) {
        expect(start).toBeGreaterThan(previous);
        expect(end).toBeGreaterThan(start);
        expect(end).toBeLessThanOrEqual(hay.length);
        previous = end - 1;
      }
    }
  });
});

describe("substringMatch", () => {
  it("marks every verbatim occurrence, ignoring case", () => {
    expect(substringMatch("ab", "Ab cab xab")).toEqual([[0, 2], [4, 6], [8, 10]]);
  });

  it("is null without one, and empty for an empty needle", () => {
    expect(substringMatch("sprt", "Support desk")).toBeNull();
    expect(substringMatch(" ", "Support desk")).toEqual([]);
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
