import { describe, expect, it } from "vitest";
import type { ChatReplyPart } from "./types";
import { gradeGoalReply } from "./goals";

const answer = (text: string): ChatReplyPart => ({
  type: "text",
  action: "search_knowledge",
  text,
});
const sources = (
  urls: (string | null)[]
): ChatReplyPart => ({
  type: "sources",
  action: "search_knowledge",
  sources: urls.map((url, i) => ({
    conceptTitle: `Concept ${i}`,
    collectionName: "General",
    sourceName: null,
    url,
  })),
});

describe("gradeGoalReply", () => {
  it("passes a grounded answer meeting every expectation", () => {
    const verdict = gradeGoalReply(
      [answer("Shipping is free over 50 and takes 3-5 days."), sources(["https://acme.com/help/shipping"])],
      {
        mustCiteSources: true,
        expectedSourceUrl: "/shipping",
        mustContain: ["free", "3-5 days"],
      }
    );
    expect(verdict).toEqual({ pass: true, detail: "" });
  });

  it("fails the fallback apology (always checked)", () => {
    const verdict = gradeGoalReply(
      [{ type: "text", action: "fallback", text: "Sorry, I ran into a problem." }],
      {}
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.detail).toContain("fallback or refusal");
  });

  it("fails a refusal part the same way", () => {
    const verdict = gradeGoalReply(
      [{ type: "text", action: "refusal", text: "I can't help with that request." }],
      {}
    );
    expect(verdict.pass).toBe(false);
  });

  it("fails an empty answer", () => {
    expect(gradeGoalReply([], {}).pass).toBe(false);
    expect(gradeGoalReply([answer("   ")], {}).pass).toBe(false);
  });

  it("fails when sources are required but absent", () => {
    const verdict = gradeGoalReply([answer("An answer.")], { mustCiteSources: true });
    expect(verdict.pass).toBe(false);
    expect(verdict.detail).toContain("no Sources");
  });

  it("fails when no cited Source URL matches", () => {
    const verdict = gradeGoalReply(
      [answer("An answer."), sources(["https://acme.com/pricing", null])],
      { expectedSourceUrl: "/shipping" }
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.detail).toContain("/shipping");
  });

  it("fails on a missing fragment, case-insensitively on hits", () => {
    expect(
      gradeGoalReply([answer("Returns accepted within 30 DAYS.")], {
        mustContain: ["30 days"],
      }).pass
    ).toBe(true);
    const verdict = gradeGoalReply([answer("Returns accepted.")], {
      mustContain: ["30 days"],
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.detail).toContain("30 days");
  });
});
