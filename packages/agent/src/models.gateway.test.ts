import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnection } from "@agent-hub/core";
import { gatewayModelId } from "./catalog";
import {
  availableModelSources,
  providerAvailability,
  resolveChatModel,
  resolveProviderCredential,
} from "./models";

/**
 * AI Gateway as a model source. Two keys can reach it, the Organization's own
 * (a `provider: "ai_gateway"` connection, customer-funded) and the platform's
 * (`AI_GATEWAY_API_KEY`, recorded as `platform`), and a stored source pins a
 * model to exactly one route.
 */

function connection(
  provider: ProviderConnection["provider"],
  key: string,
): ProviderConnection {
  return {
    id: `conn-${provider}`,
    organizationId: "org-1",
    provider,
    type: "api_key",
    displayName: provider,
    encryptedKey: `plain:${key}`,
    keyHint: "",
    config: {},
    createdBy: null,
    createdAt: "2026-01-01T00:00:00Z",
    preferredForEmbedding: false,
  };
}

const orgGateway = connection("ai_gateway", "gw-org");
const anthropicKey = connection("anthropic", "sk-byok");

beforeEach(() => {
  for (const name of [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "AI_GATEWAY_API_KEY",
  ])
    vi.stubEnv(name, undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("the Gateway's name for a model", () => {
  it("is explicit for the built-in catalogue, whose ids differ from the Gateway's", () => {
    expect(gatewayModelId("anthropic", "claude-opus-4-8")).toBe("anthropic/claude-opus-4.8");
    expect(gatewayModelId("google", "gemini-3.5-flash")).toBe("google/gemini-3.5-flash");
  });

  it("follows a retired id to the model that replaced it", () => {
    expect(availableModelSources("google", "gemini-3.1-flash-lite", [orgGateway])).toEqual([
      "ai_gateway",
    ]);
  });

  it("is absent for a built-in model the Gateway does not serve", () => {
    expect(gatewayModelId("openai", "gpt-5.1")).toBeNull();
  });

  it("is the id itself for a model the platform added from the Gateway's own catalog", () => {
    expect(gatewayModelId("openai", "gpt-5.4-nano")).toBe("openai/gpt-5.4-nano");
  });

  it("never exists for an OpenAI-compatible endpoint", () => {
    expect(gatewayModelId("openai_compatible", "llama")).toBeNull();
  });
});

describe("resolving a pinned source", () => {
  it("uses the Organization's Gateway key, customer-funded", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gw-platform");
    expect(
      resolveProviderCredential("anthropic", [anthropicKey, orgGateway], {
        source: "ai_gateway",
      }),
    ).toMatchObject({ provider: "anthropic", kind: "ai_gateway", apiKey: "gw-org", route: "gateway" });
  });

  it("keeps the platform's Gateway key a source of its own, recorded as platform", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gw-platform");
    expect(
      resolveProviderCredential("anthropic", [orgGateway], { source: "platform_gateway" }),
    ).toMatchObject({ kind: "platform", apiKey: "gw-platform", route: "gateway" });
    expect(
      resolveProviderCredential("anthropic", [anthropicKey], { source: "ai_gateway" }),
    ).toBeNull();
  });

  it("answers only from the pinned source, never another one", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-platform");
    expect(resolveProviderCredential("anthropic", [], { source: "api_key" })).toBeNull();
    expect(resolveProviderCredential("anthropic", [anthropicKey], { source: "platform" })).toMatchObject({
      kind: "platform",
      apiKey: "sk-platform",
    });
    expect(resolveProviderCredential("anthropic", [anthropicKey], { source: "ai_gateway" })).toBeNull();
  });
});

describe("resolving automatically", () => {
  it("keeps the order it always had, with the Gateway last, for a chat model", () => {
    expect(
      resolveProviderCredential("anthropic", [orgGateway, anthropicKey], { gateway: true }),
    ).toMatchObject({ kind: "api_key", apiKey: "sk-byok" });
    expect(resolveProviderCredential("anthropic", [orgGateway], { gateway: true })).toMatchObject({
      kind: "ai_gateway",
      route: "gateway",
    });
  });

  it("never hands a Gateway key to a caller that builds a native client", () => {
    // Embeddings, the decision adapter: they pass the key to the provider's own
    // SDK, which would send it to api.openai.com and fail.
    vi.stubEnv("AI_GATEWAY_API_KEY", "gw-platform");
    expect(resolveProviderCredential("openai", [orgGateway])).toBeNull();
  });
});

describe("a chat model on a pinned source", () => {
  it("runs through the Gateway under the Gateway's own model name", () => {
    const resolved = resolveChatModel("anthropic", "claude-opus-4-8", [anthropicKey, orgGateway], {
      source: "ai_gateway",
    });
    expect(resolved).toMatchObject({
      provider: "anthropic",
      modelId: "claude-opus-4-8",
      credentialKind: "ai_gateway",
      usedFallback: false,
    });
    const model = resolved!.model as { provider: string; modelId: string };
    expect(model.modelId).toBe("anthropic/claude-opus-4.8");
  });

  it("falls back automatically when the pinned route cannot serve the model", () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "sk-google");
    const resolved = resolveChatModel("openai", "gpt-5.1", [orgGateway], { source: "ai_gateway" });
    expect(resolved?.usedFallback).toBe(true);
    expect(resolved?.provider).toBe("google");
  });
});

describe("which sources can serve a model", () => {
  it("lists every route with a credential, and the Gateway only where it has the model", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-platform");
    vi.stubEnv("AI_GATEWAY_API_KEY", "gw-platform");
    expect(availableModelSources("anthropic", "claude-sonnet-5", [anthropicKey, orgGateway])).toEqual([
      "platform",
      "api_key",
      "ai_gateway",
      "platform_gateway",
    ]);
    expect(availableModelSources("openai", "gpt-5.1", [orgGateway])).toEqual([]);
  });

  it("counts the Gateway as availability for the catalog providers", () => {
    const availability = providerAvailability([orgGateway]);
    expect(availability.anthropic.gateway).toBe(true);
    expect(availability.openai_compatible.gateway).toBe(false);
  });
});
