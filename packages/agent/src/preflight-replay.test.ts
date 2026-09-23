import { describe, expect, it } from "vitest";
import { Experimental_EvaluationMockModelV4 } from "ai/test";
import {
  PREFLIGHT_MODEL_ID,
  buildPreflightQuestions,
  preflightRouting,
  spokenLanguage,
} from "@agent-hub/core";
import {
  PREFLIGHT_FIXTURE_CATALOGUE,
  PREFLIGHT_LABELLED_CASES,
} from "@agent-hub/core/testing";
import { decide, type ResolvedDecisionModel } from "./decision-model";

/**
 * The labelled pre-flight fixtures, replayed through the AI SDK (#951).
 *
 * `preflight.test.ts` in core runs the pure derivations over the labelled
 * answers. This file pushes the same answers through `decide()` on the SDK's
 * evaluation mock, so two more things are asserted that core cannot see: the
 * question map built in core is a valid SDK question map (the types are
 * structural twins, and this is where they meet), and every labelled answer
 * passes the SDK's own validation, probabilities that sum to one, a choice that
 * is the maximum, a score that is the weighted mean. A fixture the SDK would
 * reject is a fixture the real model could never have produced.
 */

const questions = buildPreflightQuestions(PREFLIGHT_FIXTURE_CATALOGUE);

function jevAnswering(labelled: (typeof PREFLIGHT_LABELLED_CASES)[number]): ResolvedDecisionModel {
  return {
    model: new Experimental_EvaluationMockModelV4({
      modelId: PREFLIGHT_MODEL_ID,
      doEvaluate: async ({ questions: asked }) => {
        // The mock answers exactly the questions it was asked, so a question
        // id that drifts between core and the fixture fails here, loudly.
        expect(Object.keys(asked).sort()).toEqual(Object.keys(labelled.answers).sort());
        return {
          answers: labelled.answers,
          rounding: { probabilityDecimals: 2, scoreDecimals: 2 },
          usage: { inputTokens: 500, outputTokens: 40 },
          providerMetadata: { typesafe: { confidence: { ...labelled.confidence } } },
          warnings: [],
        };
      },
    }),
    backend: "jev",
    provider: "typesafe",
    modelId: "typesafe-ai/jev",
    credentialKind: "platform",
    calibrated: true,
  };
}

describe("pre-flight fixtures through the SDK", () => {
  it.each(PREFLIGHT_LABELLED_CASES.map((c) => [c.id, c] as const))(
    "%s survives SDK validation and routes as labelled",
    async (_id, labelled) => {
      const decision = await decide(jevAnswering(labelled), {
        state: labelled.message,
        questions,
      });
      expect(decision.resolvedModelId).toBe(PREFLIGHT_MODEL_ID);
      expect(decision.usage.stage).toBe("decide");
      const routed = preflightRouting(
        { answers: decision.answers, confidence: decision.confidence, calibrated: decision.calibrated },
        PREFLIGHT_FIXTURE_CATALOGUE
      );
      expect(routed).toEqual(labelled.expected.routing);
      expect(
        spokenLanguage({ answers: decision.answers, confidence: decision.confidence, calibrated: true })
      ).toBe(labelled.expected.language);
    }
  );

  it("the same answers under the adapter carry no confidence and never route", async () => {
    const labelled = PREFLIGHT_LABELLED_CASES[0];
    const adapter: ResolvedDecisionModel = {
      ...jevAnswering(labelled),
      model: new Experimental_EvaluationMockModelV4({
        doEvaluate: async () => ({
          // What the structured-output adapter returns: choices without
          // distributions, and no `typesafe` metadata.
          answers: Object.fromEntries(
            Object.entries(labelled.answers).map(([id, a]) => [
              id,
              a.type === "boolean" ? a : a.type === "choice" ? { type: "choice", choice: a.choice } : { type: "score", score: a.score },
            ])
          ),
          warnings: [],
        }),
      }),
      backend: "adapter",
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
      credentialKind: "api_key",
      calibrated: false,
    };
    const decision = await decide(adapter, { state: labelled.message, questions });
    expect(decision.confidence).toEqual({});
    expect(
      preflightRouting(
        { answers: decision.answers, confidence: decision.confidence, calibrated: false },
        PREFLIGHT_FIXTURE_CATALOGUE
      )
    ).toEqual({ kind: "fallback", reason: "uncalibrated" });
  });
});
