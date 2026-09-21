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
});
