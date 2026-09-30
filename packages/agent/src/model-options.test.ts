import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelRef, ProviderConnection } from "@agent-hub/core";
import { chatModelOptions } from "./model-options";

const GEMINI: ModelRef = { provider: "google", modelId: "gemini-3.5-flash" };
const SONNET: ModelRef = { provider: "anthropic", modelId: "claude-sonnet-5" };
const GPT: ModelRef = { provider: "openai", modelId: "gpt-5.1" };

function byok(provider: ProviderConnection["provider"]): ProviderConnection {
  return {
    id: `pc-${provider}`,
    organizationId: "org-1",
    provider,
    type: "api_key",
    displayName: provider,
    // `providerAvailability` counts a key connection only when it carries one.
    encryptedKey: "cipher",
    keyHint: "…abcd",
    config:
      provider === "openai_compatible"
        ? { kind: "openai_compatible", baseUrl: "https://llm.example", chatModel: "llama-3-70b" }
        : { kind: "api_key" },
    createdBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    preferredForEmbedding: false,
  } as ProviderConnection;
}

const PLATFORM_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "AI_GATEWAY_API_KEY",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of PLATFORM_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of PLATFORM_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("chatModelOptions", () => {
  it("keeps configured and selected models visible in Preview without credentials", () => {
    const options = chatModelOptions(GEMINI, [SONNET, GPT], [], [], { includeUnavailable: true });
    expect(options.map((option) => option.provider)).toEqual(["google", "anthropic", "openai"]);
    expect(options.every((option) => option.unavailable)).toBe(true);
    expect(chatModelOptions(GEMINI, [SONNET, GPT], [])).toEqual([]);
  });

  it("marks only missing credentials as unavailable in Preview", () => {
    const options = chatModelOptions(GEMINI, [SONNET], [byok("google")], [], { includeUnavailable: true });
    expect(options[0].unavailable).toBeUndefined();
    expect(options[1].unavailable).toBe(true);
  });

  it("offers nothing when the allow-list is empty: no picker is the default", () => {
    expect(chatModelOptions(GEMINI, [], [byok("google")])).toEqual([]);
    expect(chatModelOptions(GEMINI, undefined, [byok("google")])).toEqual([]);
  });

  it("offers the configured model first, then the allowed ones", () => {
    const options = chatModelOptions(GEMINI, [SONNET], [
      byok("google"),
      byok("anthropic"),
    ]);
    expect(options.map((o) => o.selector)).toEqual([
      "google:gemini-3.5-flash",
      "anthropic:claude-sonnet-5",
    ]);
    expect(options[0].label).toBe("Gemini 3.5 Flash");
    expect(options[1].providerName).toBe("Anthropic");
  });

  // Capability, not intent: the admin still wants it, the org can no longer run
  // it, and offering it would answer on a silently different provider.
  it("drops a model whose provider has no credential", () => {
    const options = chatModelOptions(
      GEMINI,
      [SONNET, GPT],
      [byok("google"), byok("anthropic")]
    );
    expect(options.map((o) => o.provider)).toEqual(["google", "anthropic"]);
  });

  it("offers nothing when removing a connection leaves one model standing", () => {
    expect(chatModelOptions(GEMINI, [SONNET], [byok("google")])).toEqual([]);
  });

  it("drops a model the catalogue does not know", () => {
    const retired: ModelRef = { provider: "google", modelId: "gemini-1.0-pro" };
    expect(
      chatModelOptions(GEMINI, [retired], [byok("google")])
    ).toEqual([]);
  });

  it("drops openai_compatible, which has no catalogue to label", () => {
    const custom: ModelRef = {
      provider: "openai_compatible",
      modelId: "llama-3-70b",
    };
    expect(
      chatModelOptions(GEMINI, [custom], [byok("google"), byok("openai_compatible")])
    ).toEqual([]);
  });

  it("counts a platform key as a credential", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const options = chatModelOptions(GEMINI, [SONNET], [byok("google")]);
    expect(options.map((o) => o.provider)).toEqual(["google", "anthropic"]);
  });

  it("offers a verified platform model in a configured chat picker", () => {
    const added = {
      provider: "anthropic" as const,
      modelId: "claude-new",
      label: "Claude New",
      inputEurPerMillion: 1,
      outputEurPerMillion: 3,
      addedBy: "admin@example.com",
      createdAt: "2026-09-28T00:00:00.000Z",
    };
    const options = chatModelOptions(
      GEMINI,
      [{ provider: added.provider, modelId: added.modelId }],
      [byok("google"), byok("anthropic")],
      [added],
    );
    expect(options.map((option) => option.label)).toEqual(["Gemini 3.5 Flash", "Claude New"]);
  });
});

describe("a choice pinned to a source", () => {
  const gateway: ProviderConnection = {
    ...byok("ai_gateway"),
    id: "pc-gateway",
    encryptedKey: "plain:gw-org",
    config: {},
  } as ProviderConnection;
  const anthropicKey: ProviderConnection = {
    ...byok("anthropic"),
    encryptedKey: "plain:sk-byok",
  };

  it("offers the same model once per source, each tagged", () => {
    const options = chatModelOptions(GEMINI, [
      { ...SONNET, source: "api_key" },
      { ...SONNET, source: "ai_gateway" },
    ], [byok("google"), anthropicKey, gateway]);
    expect(
      options.map(({ selector, sourceName }) => [selector, sourceName]),
    ).toEqual([
      ["google:gemini-3.5-flash", undefined],
      ["anthropic:claude-sonnet-5#api_key", "API key"],
      ["anthropic:claude-sonnet-5#ai_gateway", "AI Gateway · your key"],
    ]);
  });

  it("drops a pinned source that cannot serve the model", () => {
    const options = chatModelOptions(GEMINI, [
      { ...GPT, source: "ai_gateway" },
      { ...SONNET, source: "ai_gateway" },
    ], [byok("google"), gateway]);
    expect(options.map((option) => option.selector)).toEqual([
      "google:gemini-3.5-flash",
      "anthropic:claude-sonnet-5#ai_gateway",
    ]);
  });

  it("counts the Gateway as availability for an automatic choice", () => {
    const options = chatModelOptions(GEMINI, [SONNET], [byok("google"), gateway]);
    expect(options.map((option) => option.selector)).toEqual([
      "google:gemini-3.5-flash",
      "anthropic:claude-sonnet-5",
    ]);
  });
});
