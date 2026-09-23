import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_MEMORY_CAP,
  filterExtractedMemories,
  reconcileKnowledgeMemories,
} from "./knowledge-memory-extraction";

const BODY = [
  "Employees accrue 25 days of paid leave a year.",
  "Unused leave expires on 31 March.",
  "Leave requests need a manager's approval",
  "at least two weeks ahead.",
].join("\n");

describe("filterExtractedMemories", () => {
  it("keeps an entry whose quote is in the body", () => {
    const result = filterExtractedMemories(
      [{ text: "Leave expires at the end of March.", quote: "Unused leave expires on 31 March." }],
      BODY
    );
    expect(result.kept).toEqual([
      { text: "Leave expires at the end of March.", quote: "Unused leave expires on 31 March." },
    ]);
    expect(result.refused).toBe(0);
    expect(result.capped).toBe(false);
  });

  it("refuses an invented fact, because nothing it quotes is in the page", () => {
    const result = filterExtractedMemories(
      [{ text: "Leave rolls over forever.", quote: "Unused leave never expires." }],
      BODY
    );
    expect(result.kept).toEqual([]);
    expect(result.refused).toBe(1);
  });

  it("matches across a line break the crawler happened to insert", () => {
    // The quote spans two lines in the body. A model quoting the sentence is
    // quoting the page, and a newline is not a different sentence.
    const result = filterExtractedMemories(
      [
        {
          text: "Leave needs two weeks of notice.",
          quote: "Leave requests need a manager's approval at least two weeks ahead.",
        },
      ],
      BODY
    );
    expect(result.kept).toHaveLength(1);
  });

  it("refuses an empty text or an empty quote", () => {
    const result = filterExtractedMemories(
      [
        { text: "", quote: "Unused leave expires on 31 March." },
        { text: "Something.", quote: "   " },
      ],
      BODY
    );
    expect(result.kept).toEqual([]);
    expect(result.refused).toBe(2);
  });

  it("keeps one row when the model says the same thing twice", () => {
    const entry = {
      text: "Leave expires at the end of March.",
      quote: "Unused leave expires on 31 March.",
    };
    const result = filterExtractedMemories([entry, { ...entry }], BODY);
    expect(result.kept).toHaveLength(1);
    // A repeat is not a refusal: nothing was wrong with it, it was just said
    // twice.
    expect(result.refused).toBe(0);
  });

  it("caps after the filter, so twenty good entries survive", () => {
    const good = Array.from({ length: KNOWLEDGE_MEMORY_CAP + 5 }, (_, i) => ({
      text: `Fact number ${i}.`,
      quote: "Unused leave expires on 31 March.",
    }));
    const withRefusals = [
      { text: "Invented.", quote: "Nothing like this is in the page." },
      ...good,
    ];
    const result = filterExtractedMemories(withRefusals, BODY);
    expect(result.kept).toHaveLength(KNOWLEDGE_MEMORY_CAP);
    expect(result.capped).toBe(true);
    expect(result.refused).toBe(1);
    // Page order, not an arbitrary twenty.
    expect(result.kept[0]!.text).toBe("Fact number 0.");
  });

  it("is empty and untroubled by an empty answer", () => {
    // `[]` is a correct answer for an index or a login page.
    expect(filterExtractedMemories([], BODY)).toEqual({
      kept: [],
      capped: false,
      refused: 0,
    });
  });
});

describe("reconcileKnowledgeMemories", () => {
  const existing = [
    {
      id: "m-live",
      text: "Leave expires at the end of March.",
      sourceCount: 1,
      forgottenAt: null,
    },
    {
      id: "m-forgotten",
      text: "Public holidays come out of the allowance.",
      sourceCount: 2,
      forgottenAt: "2026-09-01T00:00:00.000Z",
    },
  ];

  it("inserts a sentence the page did not have", () => {
    const plan = reconcileKnowledgeMemories(existing, [
      { text: "Employees get 25 days a year.", quote: "Employees accrue 25 days" },
    ]);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.restated).toEqual([]);
  });

  it("bumps the count on a restatement and leaves the forget state alone", () => {
    const plan = reconcileKnowledgeMemories(existing, [
      { text: "Leave expires at the end of March.", quote: "Unused leave expires on 31 March." },
      {
        text: "Public holidays come out of the allowance.",
        quote: "Public holidays do not count",
      },
    ]);
    expect(plan.inserts).toEqual([]);
    expect(plan.restated).toEqual([
      {
        id: "m-live",
        quote: "Unused leave expires on 31 March.",
        sourceCount: 2,
      },
      {
        id: "m-forgotten",
        quote: "Public holidays do not count",
        sourceCount: 3,
      },
    ]);
    // The forgotten one is restated and stays forgotten: a wrong fact a Member
    // removed does not come back because the page still says it.
    expect(plan.unrestated).toEqual([]);
  });

  it("matches a restatement through whitespace and case", () => {
    const plan = reconcileKnowledgeMemories(existing, [
      { text: "  leave expires at the END of March.  ", quote: "Unused leave" },
    ]);
    expect(plan.restated.map((row) => row.id)).toEqual(["m-live"]);
  });

  it("leaves a live memory this extraction did not restate alone", () => {
    const plan = reconcileKnowledgeMemories(existing, []);
    // Silence is not evidence: nothing here forgets it.
    expect(plan.unrestated).toEqual(["m-live"]);
    expect(plan.inserts).toEqual([]);
    expect(plan.restated).toEqual([]);
  });

  it("counts a doubled restatement once", () => {
    const entry = {
      text: "Leave expires at the end of March.",
      quote: "Unused leave expires on 31 March.",
    };
    const plan = reconcileKnowledgeMemories(existing, [entry, { ...entry }]);
    expect(plan.restated).toHaveLength(1);
    expect(plan.restated[0]!.sourceCount).toBe(2);
  });
});
