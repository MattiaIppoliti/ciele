import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  datasetForCollection,
  graphUsageProvider,
  improveDataset,
  ingestConcepts,
  isGraphWorkerConfigured,
  mapGraphProvenance,
  mapGraphUsage,
  purgeCollection,
  redactGraphWorkerSecrets,
  removeConcept,
  searchGraph,
  sendFeedback,
} from "./graph-worker";

/**
 * The graph-worker adapter's rules exercised off the network: configured-gating,
 * secret redaction, dataset-per-collection naming, and each HTTP call against
 * fake fetch responses — asserting the Bearer auth, the request envelope, that
 * the token never lands in the body, provenance mapping, and error redaction.
 * No test depends on a live worker.
 */

describe("datasetForCollection", () => {
  it("namespaces and sanitizes the collection id", () => {
    expect(datasetForCollection("Col-123")).toBe("ciele_col_col_123");
    expect(datasetForCollection("a/b c.d")).toBe("ciele_col_a_b_c_d");
  });

  it("is deterministic", () => {
    expect(datasetForCollection("x")).toBe(datasetForCollection("x"));
  });
});

describe("mapGraphProvenance", () => {
  it("maps to Concept -> Source, trims excerpts, drops null/empty entries", () => {
    expect(
      mapGraphProvenance([
        { concept_id: "c1", source_id: "s1", excerpt: "  hello  " },
        { concept_id: "c2", source_id: null, excerpt: "" },
        null,
      ])
    ).toEqual([{ conceptId: "c1", sourceId: "s1", excerpt: "hello" }]);
  });

  it("returns [] for null/undefined", () => {
    expect(mapGraphProvenance(null)).toEqual([]);
    expect(mapGraphProvenance(undefined)).toEqual([]);
  });
});

describe("mapGraphUsage", () => {
  it("maps a reported usage object to flat camelCase totals", () => {
    expect(
      mapGraphUsage({
        input_tokens: 7500,
        output_tokens: 320,
        llm_calls: 3,
        model: "gemini/gemini-2.0-flash",
        provider: "gemini",
      })
    ).toEqual({
      inputTokens: 7500,
      outputTokens: 320,
      llmCalls: 3,
      modelId: "gemini/gemini-2.0-flash",
      provider: "gemini",
    });
  });

  it("returns null when absent (older worker) or when no LLM calls ran", () => {
    expect(mapGraphUsage(undefined)).toBeNull();
    expect(mapGraphUsage(null)).toBeNull();
    // A pure CHUNKS retrieval / weight-only improve reports zero calls.
    expect(
      mapGraphUsage({ input_tokens: 0, output_tokens: 0, llm_calls: 0, model: "m", provider: "p" })
    ).toBeNull();
  });

  it("defaults missing counts and model defensively", () => {
    expect(mapGraphUsage({ llm_calls: 1 })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      llmCalls: 1,
      modelId: "unknown",
      provider: "",
    });
  });
});

describe("graphUsageProvider", () => {
  const usage = (provider: string) => ({
    inputTokens: 1,
    outputTokens: 1,
    llmCalls: 1,
    modelId: "m",
    provider,
  });

  it("folds litellm provider naming into the ledger vocabulary", () => {
    expect(graphUsageProvider(usage("gemini"))).toBe("google");
    expect(graphUsageProvider(usage("vertex_ai"))).toBe("google");
    expect(graphUsageProvider(usage("anthropic"))).toBe("anthropic");
    expect(graphUsageProvider(usage("openai"))).toBe("openai");
    // Azure / ollama / custom run over OpenAI-compatible endpoints.
    expect(graphUsageProvider(usage("azure"))).toBe("openai");
    expect(graphUsageProvider(usage("ollama"))).toBe("openai");
    expect(graphUsageProvider(usage(""))).toBe("openai");
  });
});

describe("redactGraphWorkerSecrets", () => {
  beforeEach(() => {
    process.env.GRAPH_WORKER_API_TOKEN = "super-secret-token";
  });
  afterEach(() => {
    delete process.env.GRAPH_WORKER_API_TOKEN;
  });

  it("strips the configured token", () => {
    const out = redactGraphWorkerSecrets("denied for super-secret-token here");
    expect(out).not.toContain("super-secret-token");
    expect(out).toContain("[redacted]");
  });

  it("strips bearer and authorization echoes however cased or quoted", () => {
    const out = redactGraphWorkerSecrets(
      'denied: Authorization: Bearer abc.DEF-123 and {"authorization":"xyz789"}'
    );
    expect(out).not.toContain("abc.DEF-123");
    expect(out).not.toContain("xyz789");
    expect(out).toContain("[redacted]");
  });

  it("leaves ordinary text untouched", () => {
    expect(redactGraphWorkerSecrets("graph returned no evidence.")).toBe(
      "graph returned no evidence."
    );
  });
});

describe("graph-worker HTTP calls", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    process.env.GRAPH_WORKER_BASE_URL = "https://graph.internal/";
    process.env.GRAPH_WORKER_API_TOKEN = "secret-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GRAPH_WORKER_BASE_URL;
    delete process.env.GRAPH_WORKER_API_TOKEN;
  });

  function jsonResponse(body: unknown, ok = true, status = 200) {
    return {
      ok,
      status,
      json: async () => body,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  }

  it("is configured only when both base URL and token are set", () => {
    expect(isGraphWorkerConfigured()).toBe(true);
    delete process.env.GRAPH_WORKER_API_TOKEN;
    expect(isGraphWorkerConfigured()).toBe(false);
  });

  it("ingestConcepts posts tagged documents to the collection's dataset with Bearer auth", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ingested: 2,
        usage: { input_tokens: 4000, output_tokens: 900, llm_calls: 4, model: "gemini/gemini-2.0-flash", provider: "gemini" },
      })
    );
    const result = await ingestConcepts("col-1", [
      { conceptId: "c1", sourceId: "s1", text: "alpha" },
      { conceptId: "c2", sourceId: null, text: "beta" },
    ]);
    expect(result).toEqual({
      dataset: "ciele_col_col_1",
      ingested: 2,
      usage: {
        inputTokens: 4000,
        outputTokens: 900,
        llmCalls: 4,
        modelId: "gemini/gemini-2.0-flash",
        provider: "gemini",
      },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.internal/ingest");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer secret-token");
    const body = JSON.parse(init.body);
    expect(body.dataset).toBe("ciele_col_col_1");
    expect(body.documents).toHaveLength(2);
    // Wire payload is snake_case throughout.
    expect(body.documents[0]).toEqual({ concept_id: "c1", source_id: "s1", text: "alpha" });
    // The token is never carried in the request body.
    expect(init.body).not.toContain("secret-token");
  });

  it("removeConcept targets the collection's dataset", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await removeConcept("col-1", "c9");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.internal/remove");
    expect(JSON.parse(init.body)).toEqual({ dataset: "ciele_col_col_1", concept_id: "c9" });
  });

  it("purgeCollection drops the whole dataset (dataset only, no concept)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ purged: true }));
    await purgeCollection("col-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.internal/purge");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer secret-token");
    expect(JSON.parse(init.body)).toEqual({ dataset: "ciele_col_col_1" });
  });

  it("searchGraph sends the session for a retrieval trace and maps provenance to Concept -> Source", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        answer: "  Reset it in the Identity Portal.  ",
        qa_id: "qa-7",
        provenance: [
          { concept_id: "c1", source_id: "s1", excerpt: "  Forgot password  " },
          { concept_id: "c2", source_id: null, excerpt: "" },
          null,
        ],
      })
    );
    const result = await searchGraph("col-1", "how do I reset my password?", {
      sessionId: "conv-42",
    });
    expect(result.answer).toBe("Reset it in the Identity Portal.");
    expect(result.qaId).toBe("qa-7");
    // No usage in the body (older worker / zero calls) maps to null.
    expect(result.usage).toBeNull();
    // Empty-excerpt and null entries are dropped; excerpts trimmed.
    expect(result.provenance).toEqual([
      { conceptId: "c1", sourceId: "s1", excerpt: "Forgot password" },
    ]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.internal/search");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      dataset: "ciele_col_col_1",
      query: "how do I reset my password?",
      mode: "graph_completion",
      session_id: "conv-42",
      top_k: 6,
    });
  });

  it("sendFeedback forwards score and text for the qa id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await sendFeedback("col-1", {
      sessionId: "conv-42",
      qaId: "qa-7",
      score: 1,
      text: "missed the lead time",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.internal/feedback");
    expect(JSON.parse(init.body)).toEqual({
      dataset: "ciele_col_col_1",
      session_id: "conv-42",
      qa_id: "qa-7",
      score: 1,
      text: "missed the lead time",
    });
  });

  it("searchGraph maps the worker's reported LLM usage", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        answer: "Answered.",
        qa_id: "qa-8",
        provenance: [],
        usage: { input_tokens: 7500, output_tokens: 200, llm_calls: 3, model: "gpt-5.1-mini", provider: "openai" },
      })
    );
    const result = await searchGraph("col-1", "q");
    expect(result.usage).toEqual({
      inputTokens: 7500,
      outputTokens: 200,
      llmCalls: 3,
      modelId: "gpt-5.1-mini",
      provider: "openai",
    });
  });

  it("improveDataset forwards the distill flag and returns the weighted count split by direction", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        weighted_elements: 30,
        boosted: 18,
        demoted: 12,
        usage: { input_tokens: 100, output_tokens: 50, llm_calls: 2, model: "gemini/gemini-2.0-flash", provider: "gemini" },
      })
    );
    const result = await improveDataset("col-1", { sessionIds: ["conv-42"], distill: true });
    expect(result).toEqual({
      weightedElements: 30,
      boosted: 18,
      demoted: 12,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        llmCalls: 2,
        modelId: "gemini/gemini-2.0-flash",
        provider: "gemini",
      },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      dataset: "ciele_col_col_1",
      session_ids: ["conv-42"],
      distill: true,
    });
  });

  it("improveDataset defaults to the zero-LLM weight pass (no sessions, no distill)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const result = await improveDataset("col-1");
    // Missing counts each default to 0; no reported usage maps to null.
    expect(result).toEqual({ weightedElements: 0, boosted: 0, demoted: 0, usage: null });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ dataset: "ciele_col_col_1", session_ids: null, distill: false });
  });

  it("redacts worker error detail and never leaks the token", async () => {
    fetchMock.mockResolvedValue(jsonResponse("denied token secret-token", false, 401));
    await expect(searchGraph("col-1", "q")).rejects.toThrow(/401/);
    fetchMock.mockResolvedValue(jsonResponse("denied token secret-token", false, 401));
    await expect(searchGraph("col-1", "q")).rejects.not.toThrow(/secret-token/);
  });

  it("throws a clear error when the worker is not configured", async () => {
    delete process.env.GRAPH_WORKER_BASE_URL;
    delete process.env.GRAPH_WORKER_API_TOKEN;
    await expect(ingestConcepts("col-1", [])).rejects.toThrow(
      /GRAPH_WORKER_BASE_URL and GRAPH_WORKER_API_TOKEN must be set/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

});
