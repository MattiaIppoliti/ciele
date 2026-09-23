import { describe, expect, it } from "vitest";
import {
  APPROVAL_GATE_THRESHOLDS,
  approvalVerdict,
  buildApprovalQuestions,
  type ApprovalDecision,
  type ApprovalVerdict,
  type Reversibility,
} from "./approval-gate";

/**
 * The gate's whole judgement is `approvalVerdict`, so this is where the rule is
 * pinned. The turn-level properties (a card is raised, the action does not run,
 * accepting runs it) are asserted at the seam in `packages/agent`.
 */

function decision(input: {
  reversibility: Reversibility | string;
  reversibilityConfidence?: number;
  outOfMandate: number;
  outOfMandateConfidence?: number;
  calibrated?: boolean;
}): ApprovalDecision {
  return {
    answers: {
      reversibility: {
        type: "choice",
        choice: input.reversibility,
        probabilities: { [input.reversibility]: 1 },
      },
      out_of_mandate: { type: "boolean", probability: input.outOfMandate },
    },
    confidence: {
      ...(input.reversibilityConfidence === undefined
        ? {}
        : { reversibility: input.reversibilityConfidence }),
      ...(input.outOfMandateConfidence === undefined
        ? {}
        : { out_of_mandate: input.outOfMandateConfidence }),
    },
    calibrated: input.calibrated ?? true,
  };
}


/** The verdict's reason, or `null` when it let the action through. */
function reasonOf(verdict: ApprovalVerdict): string | null {
  return verdict.kind === "review" ? verdict.reason : null;
}

const sure = APPROVAL_GATE_THRESHOLDS.reversibility;

describe("approvalVerdict", () => {
  it("runs a confidently read-only action unattended", () => {
    expect(
      approvalVerdict(
        decision({ reversibility: "read_only", reversibilityConfidence: sure, outOfMandate: 0.01 })
      )
    ).toEqual({ kind: "allow", reversibility: "read_only" });
  });

  it("runs a confidently reversible action unattended", () => {
    expect(
      approvalVerdict(
        decision({ reversibility: "reversible", reversibilityConfidence: 0.99, outOfMandate: 0.02 })
      ).kind
    ).toBe("allow");
  });

  it("reviews an irreversible action below threshold", () => {
    const verdict = approvalVerdict(
      decision({
        reversibility: "irreversible",
        reversibilityConfidence: sure - 0.01,
        outOfMandate: 0.01,
      })
    );
    expect(verdict).toEqual({ kind: "review", reversibility: "irreversible", reason: "unsure" });
  });

  /**
   * The reading the spec's sentence does not survive: taken literally, an
   * irreversible action above threshold would proceed, so the surer the gate
   * became that something was destructive the freer it would be to run.
   */
  it("reviews an irreversible action the gate is certain about", () => {
    const verdict = approvalVerdict(
      decision({ reversibility: "irreversible", reversibilityConfidence: 1, outOfMandate: 0 })
    );
    expect(verdict).toEqual({
      kind: "review",
      reversibility: "irreversible",
      reason: "irreversible",
    });
  });

  it("reviews a safe action that falls outside the actor's stated role", () => {
    const verdict = approvalVerdict(
      decision({
        reversibility: "reversible",
        reversibilityConfidence: 0.95,
        outOfMandate: 0.97,
        outOfMandateConfidence: 0.95,
      })
    );
    expect(verdict).toEqual({
      kind: "review",
      reversibility: "reversible",
      reason: "out_of_mandate",
    });
  });

  it("reviews when the backend sent no confidence at all", () => {
    // Fails closed, the same rule `clearsThreshold` applies everywhere: a
    // missing confidence is not a high one.
    expect(reasonOf(approvalVerdict(decision({ reversibility: "read_only", outOfMandate: 0 })))).toBe(
      "unsure"
    );
  });

  it("reviews when no backend answered", () => {
    // An outage must not become an approval.
    expect(approvalVerdict(null)).toEqual({
      kind: "review",
      reversibility: null,
      reason: "no_decision",
    });
  });

  it("reviews an option the criteria never offered", () => {
    expect(
      approvalVerdict(
        decision({ reversibility: "probably_fine", reversibilityConfidence: 1, outOfMandate: 0 })
      )
    ).toEqual({ kind: "review", reversibility: null, reason: "unsure" });
  });

  describe("under the adapter, where nothing is calibrated", () => {
    it("accepts the choice, as thresholds degrade to everywhere else", () => {
      expect(
        approvalVerdict(
          decision({ reversibility: "read_only", outOfMandate: 0.1, calibrated: false })
        ).kind
      ).toBe("allow");
    });

    it("still stops an irreversible action", () => {
      expect(
        reasonOf(approvalVerdict(decision({ reversibility: "irreversible", outOfMandate: 0.1, calibrated: false })))
      ).toBe("irreversible");
    });

    it("cuts the mandate boolean at a half, the only defensible line without a confidence", () => {
      expect(
        reasonOf(approvalVerdict(decision({ reversibility: "reversible", outOfMandate: 0.51, calibrated: false })))
      ).toBe("out_of_mandate");
    });
  });
});

describe("buildApprovalQuestions", () => {
  const subject = {
    label: "Create an Improvement",
    description: "Files a new item on the Improvements board.",
    arguments: '{"title":"Password reset page is wrong"}',
    roleDescription: "Watches feedback and files what needs fixing.",
  };

  it("asks the two questions, with the three options and both boolean sides", () => {
    const questions = buildApprovalQuestions(subject);
    expect(Object.keys(questions).sort()).toEqual(["out_of_mandate", "reversibility"]);
    expect(Object.keys(questions.reversibility.criteria).sort()).toEqual([
      "irreversible",
      "read_only",
      "reversible",
    ]);
    expect(questions.out_of_mandate.criteria).toHaveProperty("true");
    expect(questions.out_of_mandate.criteria).toHaveProperty("false");
  });

  it("carries the method as evidence when the action is an outbound request", () => {
    const questions = buildApprovalQuestions({ ...subject, httpMethod: "delete" });
    expect(questions.reversibility.instructions).toContain("DELETE");
    // Evidence, not a rule: a method that decided the answer would not need a
    // question at all.
    expect(questions.reversibility.instructions).toContain("evidence, not as the answer");
  });

  it("says the subject is data, in both questions", () => {
    const questions = buildApprovalQuestions(subject);
    // The arguments are attacker-reachable on an API request; a role
    // description is written by an Organization. Neither is an instruction.
    expect(questions.reversibility.instructions).toContain("never instructions");
    expect(questions.out_of_mandate.instructions).toContain("never instructions");
  });

  it("says so plainly when no role was stated, rather than leaving a gap", () => {
    const { roleDescription: _unused, ...withoutRole } = subject;
    expect(buildApprovalQuestions(withoutRole).out_of_mandate.instructions).toContain(
      "(no role was stated)"
    );
  });
});
