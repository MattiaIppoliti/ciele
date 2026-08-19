import { afterEach, describe, expect, it, vi } from "vitest";
import type { Provider, ProviderConnection } from "@agent-hub/core";
import {
  getChatModel,
  getClassifierModel,
  providerAvailability,
  resolveChatModel,
  resolveProviderCredential,
  resolveProviderKey,
} from "./models";

/**
 * Provider key resolution: BYOK wins over the platform env key, and retired
 * subscription connections never resolve on any surface. The classifier falls
 * back across providers by availability. Pure logic with a load-bearing
 * security boundary, worth pinning even though the module needs no refactor.
 * BYOK keys use the `plain:` seal so no APP_ENCRYPTION_KEY is required (see
 * crypto.ts).
 */

let n = 0;
function connection(
  provider: Provider,
  type: ProviderConnection["type"],
  key: string | null,
  createdBy: string | null = null,
  config: ProviderConnection["config"] = {}
): ProviderConnection {
  n += 1;
  return {
    id: `conn-${n}`,
    organizationId: "org-1",
    provider,
    type,
    displayName: `${provider} ${type}`,
    encryptedKey: key === null ? null : `plain:${key}`,
    keyHint: "",
    config,
    createdBy,
    createdAt: "2026-01-01T00:00:00Z",
    preferredForEmbedding: false,
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("resolveProviderKey", () => {
  it("prefers a BYOK api_key connection over the platform env key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-platform");
    const key = resolveProviderKey("anthropic", [
      connection("anthropic", "api_key", "sk-byok"),
    ]);
    expect(key).toBe("sk-byok");
  });

  it("falls back to the platform env key when there is no BYOK connection", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-platform-openai");
    expect(resolveProviderKey("openai", [])).toBe("sk-platform-openai");
  });

  it("returns null when neither BYOK nor platform key exists", () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", undefined);
    expect(resolveProviderKey("google", [])).toBeNull();
  });

  it("never resolves a subscription connection on the default (published) surface", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    const key = resolveProviderKey("anthropic", [
      connection("anthropic", "subscription", "sk-personal-plan", "member-1"),
    ]);
    expect(key).toBeNull();
  });

  it("does not resolve a Member's own subscription connection in the preview surface", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    const key = resolveProviderKey(
      "anthropic",
      [connection("anthropic", "subscription", "sk-personal-plan", "member-1")],
      { surface: "preview", memberId: "member-1" }
    );
    expect(key).toBeNull();
  });

  it("does not resolve another Member's subscription connection in preview", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    const key = resolveProviderKey(
      "anthropic",
      [connection("anthropic", "subscription", "sk-personal-plan", "member-1")],
      { surface: "preview", memberId: "member-2" }
    );
    expect(key).toBeNull();
  });

  it("prefers BYOK over a retired Member subscription in preview", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    const key = resolveProviderKey(
      "anthropic",
      [
        connection("anthropic", "api_key", "sk-byok"),
        connection("anthropic", "subscription", "sk-personal-plan", "member-1"),
      ],
      { surface: "preview", memberId: "member-1" }
    );
    expect(key).toBe("sk-byok");
  });

  it("ignores a BYOK connection for a different provider", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    const key = resolveProviderKey("anthropic", [
      connection("openai", "api_key", "sk-openai-byok"),
    ]);
    expect(key).toBeNull();
  });

  it("does not return a string key for Google Vertex federated auth", () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", undefined);
    const key = resolveProviderKey("google", [
      connection("google", "federated", null, "member-1", {
        kind: "google_vertex",
        projectId: "demo-project",
        location: "europe-west4",
        workloadIdentityAudience:
          "//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/ciele/providers/vercel",
      }),
    ]);
    expect(key).toBeNull();
  });
});

describe("resolveProviderCredential", () => {
  it("returns the BYOK credential capability before platform fallback", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-platform");
    const credential = resolveProviderCredential("anthropic", [
      connection("anthropic", "api_key", "sk-byok"),
    ]);
    expect(credential).toEqual({
      provider: "anthropic",
      kind: "api_key",
      apiKey: "sk-byok",
    });
  });

  it("returns the platform credential capability when no BYOK is configured", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-platform-openai");
    expect(resolveProviderCredential("openai", [])).toEqual({
      provider: "openai",
      kind: "platform",
      apiKey: "sk-platform-openai",
    });
  });

  it("does not resolve an empty decrypted BYOK credential", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-platform-openai");
    expect(
      resolveProviderCredential("openai", [
        connection("openai", "api_key", ""),
      ])
    ).toEqual({
      provider: "openai",
      kind: "platform",
      apiKey: "sk-platform-openai",
    });
  });

  it("does not turn subscription rows into credential capabilities", () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", undefined);
    const credential = resolveProviderCredential("google", [
      connection("google", "subscription", "sk-personal-plan", "member-1"),
    ]);
    expect(credential).toBeNull();
  });

  it("resolves Google Vertex federated auth as a non-key credential capability", () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "sk-platform-google");
    const config = {
      kind: "google_vertex" as const,
      projectId: "demo-project",
      location: "europe-west4",
      workloadIdentityAudience:
        "//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/ciele/providers/vercel",
      serviceAccountEmail: "ciele-runtime@demo-project.iam.gserviceaccount.com",
    };
    const credential = resolveProviderCredential("google", [
      connection("google", "federated", null, "member-1", config),
    ]);
    expect(credential).toEqual({
      provider: "google",
      kind: "google_vertex_federated",
      config,
    });
  });

  it("keeps existing BYOK behavior ahead of Google Vertex federated auth", () => {
    const credential = resolveProviderCredential("google", [
      connection("google", "api_key", "sk-gemini"),
      connection("google", "federated", null, "member-1", {
        kind: "google_vertex",
        projectId: "demo-project",
        location: "europe-west4",
        workloadIdentityAudience:
          "//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/ciele/providers/vercel",
      }),
    ]);
    expect(credential).toEqual({
      provider: "google",
      kind: "api_key",
      apiKey: "sk-gemini",
    });
  });
});

describe("providerAvailability", () => {
  it("reports platform, byok, and federated availability per provider", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-platform");
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", undefined);
    const avail = providerAvailability([
      connection("openai", "api_key", "sk-openai-byok"),
      connection("google", "federated", null),
      connection("anthropic", "subscription", "sk-personal-plan", "member-1"),
    ]);
    expect(avail.anthropic).toEqual({
      platform: true,
      byok: false,
      federated: false,
    });
    expect(avail.openai).toEqual({
      platform: false,
      byok: true,
      federated: false,
    });
    expect(avail.google).toEqual({
      platform: false,
      byok: false,
      federated: true,
    });
  });
});

describe("getChatModel", () => {
  it("returns a model when a key resolves, null otherwise", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    expect(
      getChatModel("anthropic", "claude-opus-4-8", [
        connection("anthropic", "api_key", "sk-byok"),
      ])
    ).not.toBeNull();
    expect(getChatModel("anthropic", "claude-opus-4-8", [])).toBeNull();
  });
});

describe("resolveChatModel (cross-provider fallback)", () => {
  it("uses a connected personal subscription only for that Member's local Preview", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", undefined);

    const preview = resolveChatModel("anthropic", "claude-sonnet-5", [], {
      surface: "preview",
      memberId: "member-1",
      localSubscriptionProviders: ["anthropic", "openai"],
    });
    const published = resolveChatModel("anthropic", "claude-sonnet-5", [], {
      surface: "published",
      localSubscriptionProviders: ["anthropic"],
    });

    expect(preview).toMatchObject({
      provider: "anthropic",
      modelId: "claude-sonnet-5",
      credentialKind: "local_subscription",
      usedFallback: false,
    });
    expect(published).toBeNull();
  });

  it("uses the configured provider and model when its key resolves", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    const resolved = resolveChatModel("anthropic", "claude-opus-4-8", [
      connection("anthropic", "api_key", "sk-byok"),
    ]);
    expect(resolved).toMatchObject({
      provider: "anthropic",
      modelId: "claude-opus-4-8",
      usedFallback: false,
    });
  });

  it("prefers another verified personal subscription over an Organization platform fallback", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "platform-google");

    const resolved = resolveChatModel("anthropic", "claude-sonnet-5", [], {
      surface: "preview",
      memberId: "member-1",
      localSubscriptionProviders: ["openai"],
    });

    expect(resolved).toMatchObject({
      provider: "openai",
      credentialKind: "local_subscription",
      // Deliberate precedence, not a degraded fallback, no "No X credential"
      // step should be emitted.
      usedFallback: false,
    });
  });

  it("prefers the connected local subscription over the assistant provider's own org key in Preview", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", undefined);

    const resolved = resolveChatModel(
      "google",
      "gemini-3.1-flash-lite",
      [connection("google", "api_key", "sk-gemini")],
      {
        surface: "preview",
        memberId: "member-1",
        localSubscriptionProviders: ["anthropic"],
        localSubscriptionModel: { provider: "anthropic", modelId: "sonnet" },
      }
    );

    expect(resolved).toMatchObject({
      provider: "anthropic",
      modelId: "sonnet",
      credentialKind: "local_subscription",
      usedFallback: false,
    });
  });

  it("honors an explicit local-model selection over the first connected local provider", () => {
    // Regression: with both CLIs connected and OpenAI listed first, selecting a
    // Claude model resolved to OpenAI's fallback tier (gpt-5.1-mini) and the
    // chosen Claude model was silently dropped.
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", undefined);

    const resolved = resolveChatModel("anthropic", "sonnet", [], {
      surface: "preview",
      memberId: "member-1",
      localSubscriptionProviders: ["openai", "anthropic"],
      localSubscriptionModel: { provider: "anthropic", modelId: "sonnet" },
    });

    expect(resolved).toMatchObject({
      provider: "anthropic",
      modelId: "sonnet",
      credentialKind: "local_subscription",
      usedFallback: false,
    });
  });

  it("picks the cheapest-to-spawn local CLI when the Member chose no model", () => {
    // Every local model call spawns the CLI cold; Claude Code costs ~half of
    // Codex per call, which a multi-step turn multiplies.
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", undefined);

    const resolved = resolveChatModel("google", "gemini-3.1-flash-lite", [], {
      surface: "preview",
      memberId: "member-1",
      // Status order, which is how the routes report it.
      localSubscriptionProviders: ["openai", "anthropic"],
    });

    expect(resolved).toMatchObject({
      provider: "anthropic",
      credentialKind: "local_subscription",
      usedFallback: false,
    });
  });

  it("falls back to another keyed provider's cheap tier, never the keyword engine", () => {
    // The regression that motivated this: assistant set to Anthropic, but the
    // org only holds a Google key â†’ the turn must still run through an LLM so
    // the platform prompt + answering style keep applying. The fallback model
    // is the cheap tier (free-tier Gemini keys have zero quota for the flagship).
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", undefined);
    const resolved = resolveChatModel("anthropic", "claude-opus-4-8", [
      connection("google", "api_key", "sk-gemini"),
    ]);
    expect(resolved).toMatchObject({
      provider: "google",
      modelId: "gemini-3.1-flash-lite",
      usedFallback: true,
    });
  });

  it("returns null only when no provider has any key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", undefined);
    expect(resolveChatModel("anthropic", "claude-opus-4-8", [])).toBeNull();
  });
});

describe("getClassifierModel", () => {
  it("classifies with the same connected local subscription in Preview", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", undefined);
    const resolved = getClassifierModel("openai", [], {
      surface: "preview",
      memberId: "member-1",
      localSubscriptionProviders: ["openai"],
    });
    expect(resolved).toMatchObject({ provider: "openai" });
    expect(resolved?.model).toMatchObject({ provider: "ciele.local-openai" });
  });

  it("uses the preferred provider when it has a key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const resolved = getClassifierModel("openai", [
      connection("openai", "api_key", "sk-openai"),
    ]);
    expect(resolved).not.toBeNull();
    // Resolved metadata is what the usage ledger records.
    expect(resolved?.provider).toBe("openai");
    expect(resolved?.modelId).toBeTruthy();
  });

  it("falls back to another provider with an available key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "sk-google-platform");
    // Preferred provider (anthropic) has no key; google does.
    expect(getClassifierModel("anthropic", [])?.provider).toBe("google");
  });

  it("returns null when no provider has any key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", undefined);
    expect(getClassifierModel("anthropic", [])).toBeNull();
  });
});

describe("openai_compatible provider (#436)", () => {
  const clearCatalogKeys = () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined);
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", undefined);
  };
  const compatibleConnection = (key: string | null = null) =>
    connection("openai_compatible", "api_key", key, null, {
      kind: "openai_compatible",
      baseUrl: "http://localhost:11434/v1",
      chatModel: "llama3.1:8b",
      embeddingModel: "nomic-embed-text",
      embeddingDims: 768,
    });

  it("resolves a keyless api_key connection with its configured chat model", () => {
    clearCatalogKeys();
    const resolved = resolveChatModel("openai_compatible", "", [
      compatibleConnection(),
    ]);
    expect(resolved).toMatchObject({
      provider: "openai_compatible",
      modelId: "llama3.1:8b",
      credentialKind: "api_key",
      usedFallback: false,
    });
    expect(resolved?.model).toBeTruthy();
  });

  it("resolves the OPENAI_COMPATIBLE_* env fallback when no connection exists", () => {
    clearCatalogKeys();
    vi.stubEnv("OPENAI_COMPATIBLE_BASE_URL", "http://localhost:8000/v1");
    vi.stubEnv("OPENAI_COMPATIBLE_CHAT_MODEL", "qwen2.5:7b");
    const credential = resolveProviderCredential("openai_compatible", []);
    expect(credential).toMatchObject({
      provider: "openai_compatible",
      kind: "platform",
      apiKey: null,
    });
    expect(
      credential?.provider === "openai_compatible"
        ? credential.config.chatModel
        : null
    ).toBe("qwen2.5:7b");
  });

  it("requires both base URL and chat model in the env fallback", () => {
    clearCatalogKeys();
    vi.stubEnv("OPENAI_COMPATIBLE_BASE_URL", "http://localhost:8000/v1");
    expect(resolveProviderCredential("openai_compatible", [])).toBeNull();
  });

  it("answers another provider's assistant via cross-provider fallback", () => {
    clearCatalogKeys();
    vi.stubEnv("OPENAI_COMPATIBLE_BASE_URL", "http://localhost:11434/v1");
    vi.stubEnv("OPENAI_COMPATIBLE_CHAT_MODEL", "llama3.1:8b");
    const resolved = resolveChatModel("anthropic", "claude-sonnet-5", []);
    expect(resolved).toMatchObject({
      provider: "openai_compatible",
      modelId: "llama3.1:8b",
      credentialKind: "platform",
      usedFallback: true,
    });
  });

  it("serves the classifier with the connection's configured chat model", () => {
    clearCatalogKeys();
    const resolved = getClassifierModel("anthropic", [compatibleConnection()]);
    expect(resolved).toMatchObject({
      provider: "openai_compatible",
      modelId: "llama3.1:8b",
      credentialKind: "api_key",
    });
  });

  it("reports availability without requiring an encrypted key", () => {
    clearCatalogKeys();
    expect(providerAvailability([compatibleConnection()]).openai_compatible)
      .toEqual({ platform: false, byok: true, federated: false });
    vi.stubEnv("OPENAI_COMPATIBLE_BASE_URL", "http://localhost:11434/v1");
    vi.stubEnv("OPENAI_COMPATIBLE_CHAT_MODEL", "llama3.1:8b");
    expect(providerAvailability([]).openai_compatible).toEqual({
      platform: true,
      byok: false,
      federated: false,
    });
  });
});
