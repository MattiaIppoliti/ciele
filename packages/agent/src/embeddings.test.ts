import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConnection } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import {
  EMBEDDING_DIMS,
  embedText,
  embedTexts,
  embedTextsWithStatus,
  padEmbedding,
} from "./embeddings";

const aiMocks = vi.hoisted(() => ({
  embed: vi.fn(),
  embedMany: vi.fn(),
}));

vi.mock("ai", () => ({
  embed: aiMocks.embed,
  embedMany: aiMocks.embedMany,
}));

/**
 * The 1536-dim padding invariant (ADR-0002 / ARCHITECTURE §7): every
 * provider's embedding is normalized to one shared pgvector column so a
 * single HNSW index serves all of them, and cosine similarity is unchanged
 * by trailing zeros. Also the lexical-fallback contract when no key resolves.
 */

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

describe("padEmbedding", () => {
  it("zero-pads a shorter vector to EMBEDDING_DIMS", () => {
    const out = padEmbedding([1, 2, 3]);
    expect(out).toHaveLength(EMBEDDING_DIMS);
    expect(out.slice(0, 3)).toEqual([1, 2, 3]);
    expect(out.slice(3).every((v) => v === 0)).toBe(true);
  });

  it("truncates a longer vector to EMBEDDING_DIMS", () => {
    const out = padEmbedding(new Array(EMBEDDING_DIMS + 100).fill(0.5));
    expect(out).toHaveLength(EMBEDDING_DIMS);
  });

  it("returns an exact-length vector unchanged", () => {
    const exact = new Array(EMBEDDING_DIMS).fill(0.1);
    expect(padEmbedding(exact)).toBe(exact);
  });

  it("preserves cosine similarity when padding both operands", () => {
    const a = [1, 0, 2, 0.5];
    const b = [0.9, 0.1, 1.8, 0.4];
    const before = cosine(a, b);
    const after = cosine(padEmbedding(a), padEmbedding(b));
    expect(after).toBeCloseTo(before, 10);
  });
});

/**
 * The org-level embedding-connection picker (#437). The choice rides on the
 * connection list, so it applies at every call site that loads connections;
 * with no choice made, the automatic provider order is unchanged.
 */
describe("org embedding-connection choice", () => {
  function connection(
    overrides: Partial<ProviderConnection> & Pick<ProviderConnection, "provider">
  ): ProviderConnection {
    return {
      id: "conn-1",
      organizationId: "org-1",
      type: "api_key",
      displayName: "",
      encryptedKey: null,
      keyHint: "",
      config: {},
      createdBy: null,
      createdAt: new Date(0).toISOString(),
      preferredForEmbedding: false,
      ...overrides,
    };
  }

  const localOllama = connection({
    id: "conn-local",
    provider: "openai_compatible",
    displayName: "Local Ollama",
    config: {
      kind: "openai_compatible",
      baseUrl: "http://localhost:11434/v1",
      chatModel: "llama3.1:8b",
      embeddingModel: "nomic-embed-text",
    },
  });

  beforeEach(() => {
    // A platform OpenAI key is present throughout: without a choice it wins
    // the automatic order, so each test shows what the choice changes.
    vi.stubEnv("OPENAI_API_KEY", "sk-platform");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", undefined);
    aiMocks.embed.mockReset();
    aiMocks.embed.mockResolvedValue({ embedding: [0.1], usage: { tokens: 4 } });
  });
  afterEach(() => vi.unstubAllEnvs());

  async function embedAndReadMeteredRow() {
    const recordAiUsage = vi.fn();
    const db = { recordAiUsage } as unknown as Db;
    return { recordAiUsage, db };
  }

  it("defaults to the automatic order when the org has chosen nothing", async () => {
    const { recordAiUsage, db } = await embedAndReadMeteredRow();
    await embedText("hello", [localOllama], { db, organizationId: "org-1" });

    expect(recordAiUsage).toHaveBeenCalledWith([
      expect.objectContaining({ provider: "openai" }),
    ]);
  });

  it("embeds with the chosen connection instead of the automatic winner", async () => {
    const { recordAiUsage, db } = await embedAndReadMeteredRow();
    await embedText(
      "hello",
      [{ ...localOllama, preferredForEmbedding: true }],
      { db, organizationId: "org-1" }
    );

    expect(recordAiUsage).toHaveBeenCalledWith([
      expect.objectContaining({
        provider: "openai_compatible",
        modelId: "nomic-embed-text",
      }),
    ]);
  });

  it("honors the choice even when a higher-priority provider is connected", async () => {
    const { recordAiUsage, db } = await embedAndReadMeteredRow();
    const openai = connection({
      id: "conn-openai",
      provider: "openai",
      encryptedKey: null,
    });
    await embedText(
      "hello",
      [openai, { ...localOllama, preferredForEmbedding: true }],
      { db, organizationId: "org-1" }
    );

    expect(recordAiUsage).toHaveBeenCalledWith([
      expect.objectContaining({ provider: "openai_compatible" }),
    ]);
  });

  it("falls back to lexical — never another model — when the choice cannot embed", async () => {
    // Anthropic has no embeddings API. Silently embedding with the platform
    // OpenAI key would split one collection across two vector spaces, which
    // is exactly what choosing a connection is meant to prevent.
    const { recordAiUsage, db } = await embedAndReadMeteredRow();
    const anthropic = connection({
      id: "conn-anthropic",
      provider: "anthropic",
      preferredForEmbedding: true,
    });

    expect(
      await embedText("hello", [anthropic], { db, organizationId: "org-1" })
    ).toBeNull();
    expect(aiMocks.embed).not.toHaveBeenCalled();
    expect(recordAiUsage).not.toHaveBeenCalled();
  });

  it("applies the choice to batch embedding too", async () => {
    aiMocks.embedMany.mockReset();
    aiMocks.embedMany.mockResolvedValue({
      embeddings: [[0.1], [0.2]],
      usage: { tokens: 9 },
    });
    const { recordAiUsage, db } = await embedAndReadMeteredRow();

    const { mode } = await embedTextsWithStatus(
      ["a", "b"],
      [{ ...localOllama, preferredForEmbedding: true }],
      { db, organizationId: "org-1" }
    );

    expect(mode).toBe("ok");
    expect(recordAiUsage).toHaveBeenCalledWith([
      expect.objectContaining({
        provider: "openai_compatible",
        modelId: "nomic-embed-text",
      }),
    ]);
  });
});

describe("embed fallback (no provider key → lexical)", () => {
  // Ensure no ambient platform key makes the resolver pick a real model.
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("embedText returns null when no embedding provider is available", async () => {
    // Empty connections + no OpenAI/Google platform key in the test env.
    expect(await embedText("hello", [], null)).toBeNull();
  });

  it("embedTexts returns a null per input when unavailable", async () => {
    expect(await embedTexts(["a", "b"], [], null)).toEqual([null, null]);
  });

  it("embedTexts returns [] for an empty batch", async () => {
    expect(await embedTexts([], [], null)).toEqual([]);
  });
});

describe("embedding usage metering (#438)", () => {
  // A platform OpenAI key resolves the first embedding provider, so the
  // metered row must carry credentialKind "platform".
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "sk-platform");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", undefined);
    aiMocks.embed.mockReset();
    aiMocks.embedMany.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("meters exactly one embed-stage row per call, fully attributed", async () => {
    aiMocks.embed.mockResolvedValue({
      embedding: [0.1, 0.2],
      usage: { tokens: 7 },
    });
    const recordAiUsage = vi.fn();
    const db = { recordAiUsage } as unknown as Db;

    const out = await embedText("hello", [], {
      db,
      organizationId: "org-1",
      assistantId: "asst-1",
      conversationId: "conv-1",
    });

    expect(out).toHaveLength(EMBEDDING_DIMS);
    expect(recordAiUsage).toHaveBeenCalledTimes(1);
    expect(recordAiUsage).toHaveBeenCalledWith([
      {
        organizationId: "org-1",
        assistantId: "asst-1",
        conversationId: "conv-1",
        stage: "embed",
        provider: "openai",
        modelId: "text-embedding-3-small",
        credentialKind: "platform",
        inputTokens: 7,
        outputTokens: 0,
      },
    ]);
  });

  it("meters a batch as one call and a provider that omits usage as zero", async () => {
    aiMocks.embedMany.mockResolvedValue({
      embeddings: [[0.1], [0.2]],
      usage: undefined,
    });
    const recordAiUsage = vi.fn();
    const db = { recordAiUsage } as unknown as Db;

    const result = await embedTextsWithStatus(["a", "b"], [], {
      db,
      organizationId: "org-1",
    });

    expect(result.mode).toBe("ok");
    expect(recordAiUsage).toHaveBeenCalledTimes(1);
    expect(recordAiUsage.mock.calls[0][0][0]).toMatchObject({
      stage: "embed",
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("a failed provider call meters nothing", async () => {
    aiMocks.embed.mockRejectedValue(new Error("provider down"));
    const recordAiUsage = vi.fn();
    const db = { recordAiUsage } as unknown as Db;

    expect(
      await embedText("hello", [], { db, organizationId: "org-1" })
    ).toBeNull();
    expect(recordAiUsage).not.toHaveBeenCalled();
  });
});

describe("openai_compatible embeddings (#436)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", undefined);
    aiMocks.embed.mockReset();
    aiMocks.embedMany.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("embeds with the env fallback's embedding model and meters under it", async () => {
    vi.stubEnv("OPENAI_COMPATIBLE_BASE_URL", "http://localhost:11434/v1");
    vi.stubEnv("OPENAI_COMPATIBLE_CHAT_MODEL", "llama3.1:8b");
    vi.stubEnv("OPENAI_COMPATIBLE_EMBEDDING_MODEL", "nomic-embed-text");
    aiMocks.embed.mockResolvedValue({
      embedding: [0.1, 0.2],
      usage: { tokens: 3 },
    });
    const recordAiUsage = vi.fn();
    const db = { recordAiUsage } as unknown as Db;

    const out = await embedText("hello", [], { db, organizationId: "org-1" });

    expect(out).toHaveLength(EMBEDDING_DIMS);
    expect(recordAiUsage).toHaveBeenCalledWith([
      expect.objectContaining({
        stage: "embed",
        provider: "openai_compatible",
        modelId: "nomic-embed-text",
        credentialKind: "platform",
        inputTokens: 3,
      }),
    ]);
  });

  it("a chat-only compatible endpoint keeps the lexical fallback", async () => {
    vi.stubEnv("OPENAI_COMPATIBLE_BASE_URL", "http://localhost:11434/v1");
    vi.stubEnv("OPENAI_COMPATIBLE_CHAT_MODEL", "llama3.1:8b");
    const recordAiUsage = vi.fn();
    const db = { recordAiUsage } as unknown as Db;

    expect(
      await embedText("hello", [], { db, organizationId: "org-1" })
    ).toBeNull();
    expect(aiMocks.embed).not.toHaveBeenCalled();
    expect(recordAiUsage).not.toHaveBeenCalled();
  });
});
