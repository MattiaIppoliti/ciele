import { afterEach, describe, expect, it, vi } from "vitest";
import { Experimental_EvaluationMockModelV4 } from "ai/test";
import { creditsFor, type Provider, type ProviderConnection } from "@agent-hub/core";
import {
  JEV_DIRECT_MODEL_ID,
  JEV_GATEWAY_MODEL_ID,
  decide,
  resolveDecisionModel,
  type ResolvedDecisionModel,
} from "./decision-model";

/**
 * The decision resolver (#950): which backend answers a decision, and what the
 * ledger row it produces looks like. Pure resolution over env + connections,
 * the same shape as models.test.ts; the one call test runs on the AI SDK's
 * evaluation mock, so no request ever leaves.
 */

let n = 0;
function connection(provider: Provider, key: string): ProviderConnection {
  n += 1;
  return {
    id: `conn-${n}`,
    organizationId: "org-1",
    provider,
    type: "api_key",
    displayName: `${provider} api_key`,
    encryptedKey: `plain:${key}`,
    keyHint: "",
    config: {},
    createdBy: null,
    createdAt: "2026-01-01T00:00:00Z",
    preferredForEmbedding: false,
  };
}

function noPlatformKeys() {
  for (const name of [
    "AI_GATEWAY_API_KEY",
    "TYPESAFE_AI_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
  ]) {
    vi.stubEnv(name, undefined);
  }
}

afterEach(() => vi.unstubAllEnvs());

describe("resolveDecisionModel", () => {
  it("resolves Jev through the Gateway when the platform Gateway key exists", () => {
    noPlatformKeys();
    vi.stubEnv("AI_GATEWAY_API_KEY", "vck-platform");
    const resolved = resolveDecisionModel("anthropic", []);
    expect(resolved).toMatchObject({
      backend: "jev",
      provider: "typesafe",
      modelId: JEV_GATEWAY_MODEL_ID,
      credentialKind: "platform",
      calibrated: true,
    });
  });

  it("prefers the Gateway over the direct provider when both keys exist", () => {
    noPlatformKeys();
    vi.stubEnv("AI_GATEWAY_API_KEY", "vck-platform");
    vi.stubEnv("TYPESAFE_AI_API_KEY", "ts-platform");
    expect(resolveDecisionModel("openai", [])?.modelId).toBe(JEV_GATEWAY_MODEL_ID);
  });

  it("resolves the direct provider when only the TypeSafe key exists", () => {
    noPlatformKeys();
    vi.stubEnv("TYPESAFE_AI_API_KEY", "ts-platform");
    expect(resolveDecisionModel("openai", [])).toMatchObject({
      backend: "jev",
      provider: "typesafe",
      modelId: JEV_DIRECT_MODEL_ID,
      calibrated: true,
    });
  });

  it("falls back to the adapter on the Organization's classifier model with no platform key", () => {
    noPlatformKeys();
    const resolved = resolveDecisionModel("anthropic", [connection("anthropic", "sk-byok")]);
    expect(resolved).toMatchObject({
      backend: "adapter",
      provider: "anthropic",
      modelId: "claude-sonnet-5",
      credentialKind: "api_key",
      calibrated: false,
    });
  });

  it("adapter: skips a preferred provider with no credential and takes the next", () => {
    noPlatformKeys();
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "sk-platform-google");
    expect(resolveDecisionModel("anthropic", [])).toMatchObject({
      backend: "adapter",
      provider: "google",
      modelId: "gemini-3.5-flash-lite",
      credentialKind: "platform",
    });
  });

  it("adapter: an openai_compatible-only Organization has no decision model", () => {
    noPlatformKeys();
    // No `evaluationModel()` exists for OpenAI-compatible endpoints, so the
    // resolver returns null rather than a model that would throw on first use.
    expect(resolveDecisionModel("openai_compatible", [])).toBeNull();
  });

  it("never resolves Jev for a turn on a Member's personal subscription", () => {
    noPlatformKeys();
    vi.stubEnv("AI_GATEWAY_API_KEY", "vck-platform");
    const personal = {
      surface: "preview" as const,
      memberId: "member-1",
      localSubscriptionProviders: ["anthropic" as const],
    };
    // The platform key is set and would answer anyone else's turn.
    expect(resolveDecisionModel("anthropic", [], { surface: "preview", memberId: "member-1" })?.backend).toBe("jev");
    expect(resolveDecisionModel("anthropic", [], personal)).toBeNull();
  });

  it("returns null when nothing can evaluate", () => {
    noPlatformKeys();
    expect(resolveDecisionModel("anthropic", [])).toBeNull();
  });
});

describe("decide", () => {
  function resolvedOn(model: Experimental_EvaluationMockModelV4, overrides: Partial<ResolvedDecisionModel> = {}): ResolvedDecisionModel {
    return {
      model,
      backend: "jev",
      provider: "typesafe",
      modelId: JEV_GATEWAY_MODEL_ID,
      credentialKind: "platform",
      calibrated: true,
      ...overrides,
    };
  }

  it("returns the typed answers, Jev's confidence, and a decide usage event priced at Jev's rate", async () => {
    const model = new Experimental_EvaluationMockModelV4({
      modelId: "jev-1.13.0",
      doEvaluate: async () => ({
        answers: {
          wants_human: { type: "boolean", probability: 0.97 },
          topic: { type: "choice", choice: "account_access", probabilities: { account_access: 1, other: 0 } },
        },
        usage: { inputTokens: 552, outputTokens: 82 },
        providerMetadata: { typesafe: { confidence: { topic: 1 } } },
        warnings: [],
      }),
    });
    const decision = await decide(resolvedOn(model), {
      state: "Ciao, non riesco ad accedere, con chi posso parlare?",
      questions: {
        wants_human: { type: "boolean", instructions: "The visitor asks for a person." },
        topic: {
          type: "choice",
          instructions: "Which situation applies.",
          criteria: { account_access: "Cannot sign in.", other: "None of the above." },
        },
      },
    });
    expect(decision.answers.wants_human).toEqual({ type: "boolean", probability: 0.97 });
    expect(decision.answers.topic.choice).toBe("account_access");
    expect(decision.confidence).toEqual({ topic: 1 });
    expect(decision.backend).toBe("jev");
    expect(decision.resolvedModelId).toBe("jev-1.13.0");
    expect(decision.usage).toEqual({
      stage: "decide",
      provider: "typesafe",
      modelId: JEV_GATEWAY_MODEL_ID,
      credentialKind: "platform",
      inputTokens: 552,
      outputTokens: 82,
    });
    // Priced from the same table the Usage page and the caps read: output
    // free, input at Jev's rate, so 552 tokens are a fraction of a credit.
    const credits = creditsFor([{ kind: "model", ...decision.usage }]);
    expect(credits).toBeGreaterThan(0);
    expect(credits).toBeLessThan(0.01);
  });

  it("under the adapter, confidence is empty and the row is priced at the classifier model", async () => {
    const model = new Experimental_EvaluationMockModelV4({
      doEvaluate: async () => ({
        answers: { ok: { type: "boolean", probability: 0.8 } },
        usage: { inputTokens: 1_000_000, outputTokens: 0 },
        warnings: [],
      }),
    });
    const decision = await decide(
      resolvedOn(model, {
        backend: "adapter",
        provider: "anthropic",
        modelId: "claude-sonnet-5",
        credentialKind: "api_key",
        calibrated: false,
      }),
      { state: "x", questions: { ok: { type: "boolean", instructions: "Is it fine." } } }
    );
    expect(decision.confidence).toEqual({});
    expect(decision.calibrated).toBe(false);
    expect(decision.usage.provider).toBe("anthropic");
    // Sonnet 5's input rate (Anthropic's classifier tier), not Jev's:
    // €2.80 per million → 280 credits.
    expect(creditsFor([{ kind: "model", ...decision.usage }])).toBeCloseTo(280, 6);
  });

  it("a provider failure propagates to the caller, which owns the fallback", async () => {
    const model = new Experimental_EvaluationMockModelV4({
      doEvaluate: async () => {
        throw new Error("provider down");
      },
    });
    await expect(
      decide(resolvedOn(model), { state: "x", questions: { ok: { type: "boolean", instructions: "?" } } })
    ).rejects.toThrow("provider down");
  });
});
