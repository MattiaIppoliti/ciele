import { afterEach, describe, expect, it, vi } from "vitest";
import { Experimental_EvaluationMockModelV4 } from "ai/test";
import { PREFLIGHT_MODEL_ID, PREFLIGHT_QUESTION_IDS } from "@agent-hub/core";
import {
  PREFLIGHT_FIXTURE_CATALOGUE,
  PREFLIGHT_LABELLED_CASES,
} from "@agent-hub/core/testing";
import { prefilterFaqs, runPreflightShadow } from "./preflight-shadow";
import type { ResolvedDecisionModel } from "./decision-model";
import type { UsageEvent } from "./types";

/**
 * The shadow pre-flight as a unit (#952). The turn-level properties, that the
 * Flow is unchanged and that courtesy never asks, are asserted at the engine
 * seam in `preflight-engine.test.ts`; what is asserted here is the contract the
 * seam relies on: this function answers, and it answers in bounded time,
 * whatever the backend does.
 */

const labelled = PREFLIGHT_LABELLED_CASES[0];

type MockEvaluate = NonNullable<
  NonNullable<ConstructorParameters<typeof Experimental_EvaluationMockModelV4>[0]>["doEvaluate"]
>;

function resolvedWith(doEvaluate: MockEvaluate): ResolvedDecisionModel {
  return {
    model: new Experimental_EvaluationMockModelV4({ modelId: PREFLIGHT_MODEL_ID, doEvaluate }),
    backend: "jev",
    provider: "typesafe",
    modelId: "typesafe-ai/jev",
    credentialKind: "platform",
    calibrated: true,
  };
}

const answering = resolvedWith(async () => ({
  answers: labelled.answers,
  rounding: { probabilityDecimals: 2, scoreDecimals: 2 },
  usage: { inputTokens: 500, outputTokens: 40 },
  providerMetadata: { typesafe: { confidence: { ...labelled.confidence } } },
  warnings: [],
}));

function collector() {
  const usage: UsageEvent[] = [];
  return { usage, recordUsage: (event: UsageEvent) => usage.push(event) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("runPreflightShadow", () => {
  it("records nothing at all when no key resolves", async () => {
    const { usage, recordUsage } = collector();
    const record = await runPreflightShadow({
      message: labelled.message,
      catalogue: PREFLIGHT_FIXTURE_CATALOGUE,
      resolved: null,
      recordUsage,
    });
    // Deliberately null rather than a `no_model` failure: a deployment with the
    // flag on and no key would otherwise stamp the same row on every trace.
    expect(record).toBeNull();
    expect(usage).toEqual([]);
  });

  it("answers every question and meters the call once", async () => {
    const { usage, recordUsage } = collector();
    const record = await runPreflightShadow({
      message: labelled.message,
      catalogue: PREFLIGHT_FIXTURE_CATALOGUE,
      resolved: answering,
      recordUsage,
    });

    expect(record?.failure).toBeUndefined();
    expect(record?.answers.map((a) => a.id)).toEqual([...PREFLIGHT_QUESTION_IDS]);
    expect(record?.wouldRoute).toEqual(labelled.expected.routing);
    expect(record?.backend).toBe("jev");
    expect(record?.calibrated).toBe(true);
    expect(usage).toHaveLength(1);
    expect(usage[0]?.stage).toBe("decide");
  });

  it("reports the confidence the provider sent, unrounded", async () => {
    const { recordUsage } = collector();
    const record = await runPreflightShadow({
      message: labelled.message,
      catalogue: PREFLIGHT_FIXTURE_CATALOGUE,
      resolved: answering,
      recordUsage,
    });
    for (const [id, value] of Object.entries(labelled.confidence)) {
      expect(record?.answers.find((a) => a.id === id)?.confidence).toBe(value);
    }
  });

  it("records a failure, and no ledger row, when the backend throws", async () => {
    const { usage, recordUsage } = collector();
    const record = await runPreflightShadow({
      message: labelled.message,
      catalogue: PREFLIGHT_FIXTURE_CATALOGUE,
      resolved: resolvedWith(async () => {
        throw new Error("gateway said no");
      }),
      recordUsage,
    });
    expect(record?.failure).toEqual({ reason: "error", message: "gateway said no" });
    expect(record?.answers).toEqual([]);
    expect(usage).toEqual([]);
  });

  /**
   * The failure that matters. #947 was exactly this shape: the throwing case
   * behaved while a call that opened and then stalled left a promise pending
   * forever. A shadow that can do that to a turn is worse than no shadow, so
   * the budget is asserted against a backend that never answers at all, not
   * against one that rejects.
   */
  it("gives up on a backend that never answers, and says it timed out", async () => {
    const { usage, recordUsage } = collector();
    const record = await runPreflightShadow({
      message: labelled.message,
      catalogue: PREFLIGHT_FIXTURE_CATALOGUE,
      resolved: resolvedWith(() => new Promise(() => {})),
      timeoutMs: 20,
      recordUsage,
    });
    expect(record?.failure).toEqual({ reason: "timeout", afterMs: 20 });
    expect(record?.answers).toEqual([]);
    expect(usage).toEqual([]);
  });

  it("asks the other six questions when the FAQ catalogue will not fit, and says so", async () => {
    const { recordUsage } = collector();
    let askedFaqOptions = 0;
    const record = await runPreflightShadow({
      message: labelled.message,
      catalogue: {
        ...PREFLIGHT_FIXTURE_CATALOGUE,
        faqs: Array.from({ length: 400 }, (_, i) => ({ id: `faq-${i}`, question: `Question ${i}?` })),
      },
      resolved: resolvedWith(async ({ questions }: Parameters<MockEvaluate>[0]) => {
        const faq = questions.faq;
        const options = faq && faq.type === "choice" ? Object.keys(faq.criteria) : [];
        askedFaqOptions = options.length;
        return {
          answers: {
            ...labelled.answers,
            // A complete distribution over whatever survived the truncation,
            // which is also how this asserts the truncated map is still one
            // the SDK will accept.
            faq: {
              type: "choice",
              choice: "none",
              probabilities: Object.fromEntries(
                options.map((option) => [option, option === "none" ? 1 : 0])
              ),
            },
          },
          rounding: { probabilityDecimals: 2, scoreDecimals: 2 },
          usage: { inputTokens: 500, outputTokens: 40 },
          providerMetadata: { typesafe: { confidence: { ...labelled.confidence } } },
          warnings: [],
        };
      }),
      recordUsage,
    });

    // 254 FAQs plus the `none` exit: the cap, not one over it.
    expect(record?.failure).toBeUndefined();
    expect(askedFaqOptions).toBe(255);
    expect(record?.faqCatalogue).toEqual({ total: 400, offered: 254 });
    expect(record?.answers).toHaveLength(PREFLIGHT_QUESTION_IDS.length);
  });
});

describe("prefilterFaqs", () => {
  const faqs = Array.from({ length: 6 }, (_, i) => ({ id: `f${i}` }));

  it("puts the ranked FAQs first, in rank order, then the catalogue's own order up to the cap", () => {
    expect(prefilterFaqs(faqs, ["f4", "f2"], 4).map((f) => f.id)).toEqual(["f4", "f2", "f0", "f1"]);
  });

  it("ignores ranked ids that are not FAQs of this catalogue, and duplicates", () => {
    expect(prefilterFaqs(faqs, ["page-9", "f5", "f5"], 3).map((f) => f.id)).toEqual(["f5", "f0", "f1"]);
  });

  it("is the prefix when nothing was ranked", () => {
    expect(prefilterFaqs(faqs, [], 2).map((f) => f.id)).toEqual(["f0", "f1"]);
  });
});
