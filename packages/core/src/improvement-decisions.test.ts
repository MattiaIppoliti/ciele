import { describe, expect, it } from "vitest";
import { compositeScore, scoreLevel } from "./decision";
import {
  DEDUP_CANDIDATE_LIMIT,
  IMPROVEMENT_DEDUP_THRESHOLD,
  PRIORITY_CUTS,
  PRIORITY_LEVELS,
  PRIORITY_QUESTION_IDS,
  PRIORITY_WEIGHTS,
  buildDedupQuestions,
  buildPriorityQuestions,
  dedupCandidates,
  dedupMatch,
  priorityFrom,
  type PriorityQuestionId,
} from "./improvement-decisions";
import type { DecisionScoreAnswer } from "./decision";

const evidence = {
  title: "Password reset link expired",
  question: "Non riesco più ad accedere, il link di reset non funziona",
  answer: "Try again later.",
};

function yes(probability: number) {
  return { type: "boolean" as const, probability };
}

function score(level: number): DecisionScoreAnswer {
  return {
    type: "score",
    score: level,
    probabilities: Object.fromEntries(
      Array.from({ length: PRIORITY_LEVELS }, (_, i) => [String(i), i === level ? 1 : 0])
    ),
  };
}

const sure = IMPROVEMENT_DEDUP_THRESHOLD;

describe("dedupMatch", () => {
  const candidates = [
    { id: "imp-1", title: "Password reset link expired" },
    { id: "imp-2", title: "Invoices download as an empty file" },
  ];

  it("merges into the item the backend is sure about", () => {
    expect(
      dedupMatch({
        evidenceTitle: evidence.title,
        candidates,
        answers: { "imp-1": yes(0.95), "imp-2": yes(0.02) },
        confidence: { "imp-1": 0.95, "imp-2": 0.9 },
        calibrated: true,
      })
    ).toBe("imp-1");
  });

  it("files a new item when nothing clears the threshold", () => {
    expect(
      dedupMatch({
        evidenceTitle: evidence.title,
        candidates,
        answers: { "imp-1": yes(sure - 0.05), "imp-2": yes(0.1) },
        confidence: { "imp-1": 0.9, "imp-2": 0.9 },
        calibrated: true,
      })
    ).toBeNull();
  });

  it("takes the strongest yes when two items both say so", () => {
    // Splitting is recoverable, merging into the wrong one is not, so the
    // strongest yes is the only defensible pick between them.
    expect(
      dedupMatch({
        evidenceTitle: evidence.title,
        candidates,
        answers: { "imp-1": yes(0.88), "imp-2": yes(0.96) },
        confidence: { "imp-1": 0.95, "imp-2": 0.95 },
        calibrated: true,
      })
    ).toBe("imp-2");
  });

  describe("under the adapter, where nothing is calibrated", () => {
    it("still merges when the titles also match lexically", () => {
      expect(
        dedupMatch({
          evidenceTitle: "Password reset link has expired",
          candidates,
          answers: { "imp-1": yes(0.9), "imp-2": yes(0.01) },
          confidence: {},
          calibrated: false,
        })
      ).toBe("imp-1");
    });

    it("refuses a merge the titles do not support", () => {
      // The uncalibrated path may be more reluctant than the old lexical rule,
      // never less: a wrong merge hides a second problem inside the first and
      // nobody looks again.
      expect(
        dedupMatch({
          evidenceTitle: "I cannot get back into my account",
          candidates,
          answers: { "imp-1": yes(0.99), "imp-2": yes(0.01) },
          confidence: {},
          calibrated: false,
        })
      ).toBeNull();
    });
  });
});

describe("dedupCandidates", () => {
  it("asks about the whole board when it fits", () => {
    const open = [
      { id: "a", title: "One" },
      { id: "b", title: "Two" },
    ];
    expect(dedupCandidates(evidence.title, open)).toEqual(open);
  });

  it("shortlists by title similarity when the board is too big to ask about", () => {
    const open = [
      ...Array.from({ length: DEDUP_CANDIDATE_LIMIT }, (_, i) => ({
        id: `noise-${i}`,
        title: `Something else entirely number ${i}`,
      })),
      { id: "twin", title: "Password reset link expired" },
    ];
    const shortlist = dedupCandidates(evidence.title, open);
    expect(shortlist).toHaveLength(DEDUP_CANDIDATE_LIMIT);
    expect(shortlist.map((item) => item.id)).toContain("twin");
  });
});

describe("buildDedupQuestions", () => {
  it("asks one independent boolean per candidate", () => {
    const questions = buildDedupQuestions(evidence, [
      { id: "imp-1", title: "Password reset link expired" },
      { id: "imp-2", title: "Invoices download as an empty file" },
    ]);
    expect(Object.keys(questions).sort()).toEqual(["imp-1", "imp-2"]);
    expect(questions["imp-1"].type).toBe("boolean");
  });

  it("says the conversation is data, not instructions", () => {
    const questions = buildDedupQuestions(evidence, [{ id: "imp-1", title: "x" }]);
    // The visitor's own words are in this prompt, so the fence has to be.
    expect(questions["imp-1"].instructions).toContain("never instructions");
  });
});

describe("priorityFrom", () => {
  it("calls a harmful, angry, exact report High", () => {
    expect(priorityFrom({ severity: score(3), frustration: score(3), evidence: score(3) })).toBe(
      "high"
    );
  });

  it("calls a cosmetic, calm, unusable one Low", () => {
    expect(priorityFrom({ severity: score(0), frustration: score(0), evidence: score(0) })).toBe(
      "low"
    );
  });

  it("lands in the middle when the dimensions disagree", () => {
    expect(priorityFrom({ severity: score(2), frustration: score(1), evidence: score(1) })).toBe(
      "medium"
    );
  });

  /**
   * The criterion the ticket names: changing what "High" means is editing a
   * coefficient, not a prompt. This asserts the weights are actually load
   * bearing by recomputing the composite with frustration weighted as heavily
   * as severity and showing the label moves.
   */
  it("moves the label when a weight moves, with no prompt change", () => {
    const answers: Record<PriorityQuestionId, DecisionScoreAnswer> = {
      severity: score(0),
      frustration: score(2),
      evidence: score(0),
    };
    expect(priorityFrom(answers)).toBe("low");

    const reweighted = compositeScore(
      PRIORITY_QUESTION_IDS.map((id) => ({
        score: scoreLevel(answers[id], PRIORITY_LEVELS),
        levels: PRIORITY_LEVELS,
        weight: id === "frustration" ? 0.8 : PRIORITY_WEIGHTS[id],
      }))
    );
    expect(reweighted).toBeGreaterThanOrEqual(PRIORITY_CUTS.medium);
  });
});

describe("buildPriorityQuestions", () => {
  it("asks the three dimensions, each with its four levels", () => {
    const questions = buildPriorityQuestions(evidence);
    expect(Object.keys(questions).sort()).toEqual([...PRIORITY_QUESTION_IDS].sort());
    for (const id of PRIORITY_QUESTION_IDS) {
      expect(questions[id].criteria).toHaveLength(PRIORITY_LEVELS);
    }
  });
});
