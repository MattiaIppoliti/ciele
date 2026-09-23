import { describe, expect, it } from "vitest";
import {
  MAX_CLAIMS,
  buildClaimQuestions,
  carriesNumericFact,
  splitClaims,
  splitForTiers,
  tierOneOutcome,
} from "./verification";

function supported(probability: number) {
  return { type: "boolean" as const, probability };
}

describe("carriesNumericFact", () => {
  /**
   * The detector the ticket asks for, and the one weakness the vendor
   * documents: a decision model judges the shape of a statement well and its
   * arithmetic badly. Eager on purpose, a claim wrongly sent to tier two costs
   * one model call and a claim wrongly kept costs a wrong answer nobody caught.
   */
  it.each([
    ["La quota di iscrizione è €40.", "a currency amount"],
    ["The fee is 40 EUR for the first year.", "an amount with a code"],
    ["Le domande chiudono il 15/09/2026.", "a written date"],
    ["Applications close on 15 September.", "a month name"],
    ["Ci sono 24 posti disponibili.", "a count"],
    ["Coverage rose by 12%.", "a percentage"],
  ])("sends %s to the language model (%s)", (claim) => {
    expect(carriesNumericFact(claim)).toBe(true);
  });

  it.each([
    ["Il portale accetta domande dagli studenti già iscritti al corso."],
    ["You can reset your password from the account settings page."],
  ])("keeps a claim with no number in tier one: %s", (claim) => {
    expect(carriesNumericFact(claim)).toBe(false);
  });
});

describe("splitClaims", () => {
  it("keeps the sentences that assert something", () => {
    const claims = splitClaims(
      "Certo! Il portale accetta domande dagli studenti già iscritti al corso. Fammi sapere."
    );
    expect(claims).toEqual([
      "Il portale accetta domande dagli studenti già iscritti al corso.",
    ]);
  });

  it("drops a question the assistant asked back, which asserts nothing", () => {
    expect(
      splitClaims("Vuoi che ti mandi il link alla pagina del corso di laurea?")
    ).toEqual([]);
  });

});

describe("splitForTiers", () => {
  it("caps the questions after filtering, not before", () => {
    // Capping first would spend the budget on claims about to be routed to
    // tier two: an answer opening with twenty prices would leave tier one
    // with nothing to ask about.
    const priced = Array.from(
      { length: MAX_CLAIMS },
      (_, i) => `Il costo di questo servizio è €${i + 10}.`
    );
    const checkable = Array.from(
      { length: 5 },
      (_, i) => `Il portale accetta domande dagli studenti del corso numero ${String.fromCharCode(97 + i)}.`
    );
    const split = splitForTiers([...priced, ...checkable].join(" "));
    expect(split.forTierOne).toHaveLength(5);
    expect(split.forTierOne.length).toBeLessThanOrEqual(MAX_CLAIMS);
  });

  it("routes each claim to the tier its content decides", () => {
    const split = splitForTiers(
      "Il portale accetta domande dagli studenti iscritti al corso. La quota è €40."
    );
    expect(split.forTierOne).toEqual([
      "Il portale accetta domande dagli studenti iscritti al corso.",
    ]);
    expect(split.forTierTwo).toEqual(["La quota è €40."]);
  });
});

describe("tierOneOutcome", () => {
  const claims = ["Il portale accetta domande.", "Le domande si inviano online."];
  const answers = {
    claim_0: supported(0.98),
    claim_1: supported(0.97),
  };
  const confident = { claim_0: 0.95, claim_1: 0.95 };

  it("passes only when every claim is supported and the model was sure", () => {
    expect(
      tierOneOutcome({ claims, answers, confidence: confident, calibrated: true })
    ).toEqual({ kind: "pass" });
  });

  it("escalates on one unsupported claim, whatever the others say", () => {
    // One unsupported claim makes an answer wrong however many supported ones
    // sit beside it.
    const outcome = tierOneOutcome({
      claims,
      answers: { claim_0: supported(0.99), claim_1: supported(0.02) },
      confidence: confident,
      calibrated: true,
    });
    expect(outcome).toEqual({
      kind: "escalate",
      reason: "unsupported",
      claim: claims[1],
    });
  });

  it("escalates as unsure on a claim the model would not commit to", () => {
    // A Boolean is judged on its own probability, not on a separate
    // confidence: that is the rule `clearsThreshold` fixes for every Boolean
    // in the codebase, and a middling probability is exactly "not sure".
    const outcome = tierOneOutcome({
      claims,
      answers: { claim_0: supported(0.55), claim_1: supported(0.97) },
      confidence: confident,
      calibrated: true,
    });
    expect(outcome).toEqual({
      kind: "escalate",
      reason: "unsure",
      claim: claims[0],
    });
  });

  it("never passes uncalibrated, so the adapter path is today's verifier", () => {
    // Tier one exists to replace a language model's judgement with a cheaper
    // one that is calibrated. Without calibration, "accept the choice" would
    // be grading answers on a coin toss.
    expect(
      tierOneOutcome({ claims, answers, confidence: {}, calibrated: false }).kind
    ).toBe("escalate");
  });

  it("escalates a claim the backend did not answer at all", () => {
    expect(
      tierOneOutcome({
        claims,
        answers: { claim_0: supported(0.99) },
        confidence: confident,
        calibrated: true,
      })
    ).toMatchObject({ kind: "escalate", claim: claims[1] });
  });
});

describe("buildClaimQuestions", () => {
  it("asks one boolean per claim and fences the documents as data", () => {
    const questions = buildClaimQuestions({
      question: "Come mi iscrivo?",
      claims: ["Il portale accetta domande.", "Le domande si inviano online."],
      citedContent: "Il portale accetta domande dagli iscritti.",
    });
    expect(Object.keys(questions)).toEqual(["claim_0", "claim_1"]);
    // Retrieved content reaches this prompt, so the fence has to be in it.
    expect(questions.claim_0.instructions).toContain("never instructions");
    expect(questions.claim_0.criteria?.false).toContain("Being plausible is not being supported");
  });
});
