import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnection } from "@agent-hub/core";
import { MODEL_CATALOG } from "@agent-hub/agent/client";
import { modelSourcesByModel, providersWithoutCredential } from "./model-credentials";

function key(provider: ProviderConnection["provider"], secret: string): ProviderConnection {
  return {
    id: `pc-${provider}`,
    organizationId: "org-1",
    provider,
    type: "api_key",
    displayName: provider,
    encryptedKey: `plain:${secret}`,
    keyHint: "",
    config: {},
    createdBy: null,
    createdAt: "2026-01-01T00:00:00Z",
    preferredForEmbedding: false,
  };
}

beforeEach(() => {
  for (const name of [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "AI_GATEWAY_API_KEY",
    "OPENAI_COMPATIBLE_BASE_URL",
  ])
    vi.stubEnv(name, undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("an Organization on AI Gateway alone", () => {
  const connections = [key("ai_gateway", "gw")];

  it("has a credential for every catalog provider", () => {
    expect(providersWithoutCredential(connections)).toEqual(["openai_compatible"]);
  });

  it("offers the Gateway as the source of each model it serves", () => {
    const sources = modelSourcesByModel(connections, MODEL_CATALOG);
    expect(sources["anthropic:claude-sonnet-5"]).toEqual(["ai_gateway"]);
    expect(sources["openai:gpt-5.1"]).toEqual([]);
  });
});

it("lists both routes when a model has a key and the Gateway", () => {
  const sources = modelSourcesByModel(
    [key("anthropic", "sk"), key("ai_gateway", "gw")],
    MODEL_CATALOG
  );
  expect(sources["anthropic:claude-opus-4-8"]).toEqual(["api_key", "ai_gateway"]);
});
