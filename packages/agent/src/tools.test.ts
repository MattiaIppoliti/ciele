import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApiIntegration,
  Assistant,
  KnowledgeSearchResult,
} from "@agent-hub/core";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("./pinned-fetch", () => ({
  pinnedRequest: vi.fn(),
  fetchPinnedPage: vi.fn(),
}));

import { lookup } from "node:dns/promises";
import { pinnedRequest, type PinnedFetchResponse } from "./pinned-fetch";
import { createTurnSession } from "./session";
import { PROGRESS_MAX_CHARS } from "@agent-hub/core";
import {
  MAX_QUERIES_PER_SEARCH,
  buildToolset,
  normalizeSearchQueries,
  type ToolRuntimeContext,
} from "./tools";
import { createLoopBudget } from "./agentic-search";
import type { RuntimeEvent } from "./types";

// HTTP-egress seams (the fetchUrl + custom tools route through the shared
// egress guard): DNS resolution and the pinned transport are mocked; the
// guard's validation logic itself runs for real.
const lookupMock = vi.mocked(lookup);
const requestMock = vi.mocked(pinnedRequest);

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ] as never);
  requestMock.mockReset();
});

function pinnedResponse(
  status: number,
  headers: Record<string, string> = {},
  text = ""
): PinnedFetchResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    text,
  };
}

/**
 * The Runtime Tool Registry: which tools an assistant's config yields, and the
 * instrument wrapper's tool-start/tool-end lifecycle contract (structured
 * payloads, error containment — a throwing tool never aborts the turn).
 */

function makeAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    id: "assistant-1",
    organizationId: "org-1",
    title: "Campus Assistant",
    nickname: "Campus AI",
    description: "",
    welcomeMessage: "",
    aiDisclaimer: "",
    suggestedQuestions: [],
    quickReplies: [],
    answeringStyle: "",
    simplifiedThinking: false,
    chatLauncherEnabled: true,
    modelProvider: "anthropic",
    modelId: "claude-opus-4-8",
    style: {},
    allowedDomains: [],
    helpDeskSettings: {},
    tools: {},
    requireSignIn: false,
    knowledgeEngine: "graph",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeContext(overrides: Partial<ToolRuntimeContext> = {}) {
  const events: RuntimeEvent[] = [];
  const ctx: ToolRuntimeContext = {
    assistant: makeAssistant(),
    session: createTurnSession("c1", {}),
    usedSources: [],
    searchPasses: [],
    emit: (e) => events.push(e),
    ...overrides,
  };
  return { ctx, events };
}

/**
 * The argument names a toolset entry offers the model. Reaching into the zod
 * object's shape is the point: what the model is *offered* is the thing under
 * test, and the SDK's Tool type erases it back to an opaque schema.
 */
function schemaFields(
  toolset: ReturnType<typeof buildToolset>,
  name: string
): string[] {
  const entry = toolset[name] as unknown as {
    inputSchema: { shape: Record<string, unknown> };
  };
  return Object.keys(entry.inputSchema.shape);
}

/** Runs a toolset entry the way the AI SDK would. */
async function run(
  toolset: ReturnType<typeof buildToolset>,
  name: string,
  input: Record<string, unknown>
) {
  const entry = toolset[name] as {
    execute: (i: unknown, o: unknown) => Promise<unknown>;
  };
  return entry.execute(input, { toolCallId: "call-1", messages: [] });
}

describe("buildToolset gating", () => {
  it("defaults: searchKnowledge, remember on; fetchUrl off", () => {
    const { ctx } = makeContext();
    expect(Object.keys(buildToolset(ctx)).sort()).toEqual([
      "remember",
      "searchKnowledge",
    ]);
  });

  it("honors builtIns overrides, but searchKnowledge stays on", () => {
    const { ctx } = makeContext({
      assistant: makeAssistant({
        tools: {
          builtIns: {
            fetchUrl: true,
            remember: false,
            searchKnowledge: false,
          },
        },
      }),
    });
    expect(Object.keys(buildToolset(ctx)).sort()).toEqual([
      "fetchUrl",
      "searchKnowledge",
    ]);
  });

  it("ignores a stored `custom` key left over from the per-endpoint tools", () => {
    // The contract step of spec #559 removed them from the type, but a
    // pre-existing `assistants.tools` row may still carry the key — reading it
    // must register nothing rather than throw.
    const { ctx } = makeContext({
      assistant: makeAssistant({
        tools: {
          custom: [
            { id: "1", name: "lookup_account", url: "https://x.it", method: "GET" },
          ],
        } as never,
      }),
    });
    expect(Object.keys(buildToolset(ctx)).sort()).toEqual([
      "remember",
      "searchKnowledge",
    ]);
  });
});

describe("tool lifecycle events", () => {
  it("emits tool-start and a successful tool-end with structured payloads", async () => {
    const { ctx, events } = makeContext();
    const output = await run(buildToolset(ctx), "remember", {
      fact: "Student of Marketing",
    });
    expect(output).toEqual({ saved: true });
    expect(events[0]).toMatchObject({
      type: "tool-start",
      callId: "call-1",
      tool: "remember",
      label: "Saving to session memory",
      input: { fact: "Student of Marketing" },
    });
    expect(events[1]).toMatchObject({
      type: "tool-end",
      callId: "call-1",
      tool: "remember",
      ok: true,
      summary: "Saved",
    });
    expect((events[1] as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
  });

  it("keeps the progress field out of the schema when Simplified thinking is off", () => {
    // Off must be identical to the behaviour before the feature existed: no
    // schema field means the model is never even asked to narrate (#560).
    const { ctx } = makeContext();
    const toolset = buildToolset(ctx);
    for (const name of ["remember", "searchKnowledge"]) {
      expect(schemaFields(toolset, name)).not.toContain("progress");
    }
  });

  it("narrates a tool phase and keeps the line out of the tool's arguments", async () => {
    const narrated: Array<[string, string]> = [];
    const { ctx, events } = makeContext({
      narrate: (t, tool) => narrated.push([t, tool]),
    });
    const toolset = buildToolset(ctx);
    expect(schemaFields(toolset, "remember")).toContain("progress");

    const output = await run(toolset, "remember", {
      fact: "Student of Marketing",
      progress: "  Mi segno che studi Marketing…  ",
    });
    expect(output).toEqual({ saved: true });
    // The sink learns WHICH phase the line narrates (#576), so the persisted
    // part can carry it.
    expect(narrated).toEqual([["Mi segno che studi Marketing…", "remember"]]);
    // The narration is display copy, not an argument: a tool that forwards its
    // arguments (queryApi puts them on the request) would otherwise send the
    // narration to the tenant's API as a parameter.
    expect(events[0]).toMatchObject({
      type: "tool-start",
      input: { fact: "Student of Marketing" },
    });
    expect((events[0] as { input: Record<string, unknown> }).input).not.toHaveProperty(
      "progress"
    );
  });

  it("narrates a knowledge search too, and caps the line", async () => {
    const narrated: Array<[string, string]> = [];
    const { ctx } = makeContext({
      narrate: (t, tool) => narrated.push([t, tool]),
      searchKnowledge: async () => [],
    });
    await run(buildToolset(ctx), "searchKnowledge", {
      queries: ["fees"],
      progress: "x".repeat(500),
    });
    expect(narrated).toHaveLength(1);
    expect(narrated[0][0]).toHaveLength(PROGRESS_MAX_CHARS);
    expect(narrated[0][1]).toBe("searchKnowledge");
  });

  it("narrates nothing when the model omits or blanks the line", async () => {
    const narrated: string[] = [];
    const { ctx } = makeContext({ narrate: (t) => narrated.push(t) });
    const toolset = buildToolset(ctx);
    await run(toolset, "remember", { fact: "a" });
    await run(toolset, "remember", { fact: "b", progress: "   " });
    expect(narrated).toEqual([]);
  });

  it("contains a throwing execute: error result for the model, ok:false event", async () => {
    const { ctx, events } = makeContext({
      searchKnowledge: async () => {
        throw new Error("index offline");
      },
    });
    const output = await run(buildToolset(ctx), "searchKnowledge", {
      query: "fees",
    });
    expect(output).toEqual({ error: "index offline" });
    expect(events[1]).toMatchObject({
      type: "tool-end",
      ok: false,
      summary: "index offline",
    });
  });
});

describe("searchKnowledge tool", () => {
  const result: KnowledgeSearchResult = {
    conceptId: "k1",
    conceptTitle: "Tuition fees",
    conceptPath: "fees.md",
    collectionId: "col1",
    collectionName: "General",
    sourceName: "Website",
    resourceUrl: null,
    content: "Fees are …",
    similarity: 0.9,
  };

  it("collects used sources and reshapes results for the model", async () => {
    const { ctx } = makeContext({ searchKnowledge: async () => [result] });
    const output = await run(buildToolset(ctx), "searchKnowledge", {
      query: "fees",
    });
    expect(output).toEqual({
      results: [
        {
          concept: "Tuition fees",
          collection: "General",
          source: "Website",
          content: "Fees are …",
        },
      ],
    });
    expect(ctx.usedSources).toEqual([result]);
  });

  it("tells the model honestly when nothing matches", async () => {
    const { ctx } = makeContext({ searchKnowledge: async () => [] });
    const output = (await run(buildToolset(ctx), "searchKnowledge", {
      query: "x",
    })) as { results: unknown[]; note: string };
    expect(output.results).toEqual([]);
    expect(output.note).toContain("No matching knowledge");
  });
});

describe("searchKnowledge multi-query batching (#558)", () => {
  const hit = (title: string): KnowledgeSearchResult => ({
    conceptId: title,
    conceptTitle: title,
    conceptPath: `${title}.md`,
    collectionId: "col1",
    collectionName: "General",
    sourceName: "Website",
    resourceUrl: null,
    content: `About ${title}`,
    similarity: 0.9,
  });

  it("normalizes both input shapes, dedupes and caps the batch", () => {
    expect(normalizeSearchQueries({ queries: ["a", "b"] })).toEqual(["a", "b"]);
    // A model that sends the single-query form must not lose its search: schema
    // validation runs before execute, so a rejection costs a whole iteration.
    expect(normalizeSearchQueries({ query: "a" })).toEqual(["a"]);
    expect(normalizeSearchQueries({ queries: "a" })).toEqual(["a"]);
    expect(normalizeSearchQueries({ queries: ["a", " a ", "", "b"] })).toEqual([
      "a",
      "b",
    ]);
    expect(
      normalizeSearchQueries({ queries: ["a", "b", "c", "d", "e", "f"] })
    ).toHaveLength(MAX_QUERIES_PER_SEARCH);
    expect(normalizeSearchQueries({})).toEqual([]);
  });

  it("runs one pass per query but reports them as one panel row", async () => {
    const searchKnowledge = vi.fn(async (query: string) => [hit(query)]);
    const loop = createLoopBudget(6);
    const { ctx, events } = makeContext({ searchKnowledge, loop });

    const output = (await run(buildToolset(ctx), "searchKnowledge", {
      queries: ["fees", "deadlines"],
    })) as { results?: unknown[]; systemNote?: string };

    // Two passes on the ledger, so the budget and coverage gates still see the
    // real work — but one model decision, so one row in the Thinking panel.
    expect(searchKnowledge).toHaveBeenCalledTimes(2);
    expect(ctx.searchPasses).toHaveLength(2);
    expect(events.filter((e) => e.type === "tool-start")).toHaveLength(1);
    expect(events.filter((e) => e.type === "tool-end")).toHaveLength(1);
    const start = events.find((e) => e.type === "tool-start")!;
    expect(start.label).toContain("- fees");
    expect(start.label).toContain("- deadlines");
    expect(output.results).toHaveLength(2);

    // One call is one iteration, however many queries it batched — that is the
    // whole incentive to batch.
    expect(loop.iteration).toBe(1);
    expect(output.systemNote).toContain("iteration 1 out of 6");
  });

  it("keeps the queries that worked when one of them throws", async () => {
    const searchKnowledge = vi.fn(async (query: string) => {
      if (query === "broken") throw new Error("index down");
      return [hit("fine")];
    });
    const { ctx } = makeContext({ searchKnowledge, loop: createLoopBudget(6) });
    const output = (await run(buildToolset(ctx), "searchKnowledge", {
      queries: ["broken", "fine"],
    })) as { results?: unknown[]; error?: string };

    expect(output.error).toBeUndefined();
    expect(output.results).toHaveLength(1);
  });

  it("reports the failure when every query in the batch throws", async () => {
    const { ctx } = makeContext({
      searchKnowledge: async () => {
        throw new Error("index down");
      },
      loop: createLoopBudget(6),
    });
    const output = (await run(buildToolset(ctx), "searchKnowledge", {
      queries: ["a", "b"],
    })) as { error?: string };
    expect(output.error).toBe("index down");
  });

  it("errors without spending a search when no query came through", async () => {
    const searchKnowledge = vi.fn(async () => []);
    const { ctx } = makeContext({ searchKnowledge, loop: createLoopBudget(6) });
    const output = (await run(buildToolset(ctx), "searchKnowledge", {})) as {
      error?: string;
    };
    expect(output.error).toContain("No search query");
    expect(searchKnowledge).not.toHaveBeenCalled();
  });
});

describe("spoken iteration budget (#558)", () => {
  it("tells the model its iteration on every instrumented tool result", async () => {
    const loop = createLoopBudget(6);
    const { ctx } = makeContext({ loop });
    const toolset = buildToolset(ctx);

    const first = (await run(toolset, "remember", { fact: "prefers email" })) as {
      systemNote?: string;
    };
    expect(first.systemNote).toContain("iteration 1 out of 6");

    // One charge per STEP — the loop closes each step between generations.
    for (let i = 0; i < 4; i++) {
      loop.endStep();
      await run(toolset, "remember", { fact: `fact ${i}` });
    }
    loop.endStep();
    const last = (await run(toolset, "remember", { fact: "last" })) as {
      systemNote?: string;
    };
    // The last iteration says so in the strongest terms — being cut off is not
    // the same as knowing the limit.
    expect(loop.iteration).toBe(6);
    expect(last.systemNote).toContain("CRITICAL");
  });

  it("charges one iteration for a step that calls several tools at once", async () => {
    // The API-catalogue pattern (#559) fetches endpoint details in parallel on
    // purpose; charging per call would spend the budget on discovery alone.
    const loop = createLoopBudget(6);
    const { ctx } = makeContext({ loop, searchKnowledge: async () => [] });
    const toolset = buildToolset(ctx);
    await Promise.all([
      run(toolset, "remember", { fact: "a" }),
      run(toolset, "remember", { fact: "b" }),
      run(toolset, "searchKnowledge", { queries: ["c"] }),
    ]);
    expect(loop.iteration).toBe(1);
  });

  it("stamps the iteration on the tool-start event, for the transcript", async () => {
    const loop = createLoopBudget(6);
    const { ctx, events } = makeContext({ loop });
    await run(buildToolset(ctx), "remember", { fact: "x" });
    const start = events.find((e) => e.type === "tool-start")!;
    expect(start.iteration).toBe(1);
  });

  it("leaves results untouched when no budget is wired", async () => {
    // The deterministic no-model path and pure tests: the note is guidance,
    // never load-bearing.
    const { ctx } = makeContext({ searchKnowledge: async () => [] });
    const output = (await run(buildToolset(ctx), "searchKnowledge", {
      query: "x",
    })) as Record<string, unknown>;
    expect(output.systemNote).toBeUndefined();
  });
});

describe("remember tool", () => {
  it("writes into the session memory", async () => {
    const { ctx } = makeContext();
    await run(buildToolset(ctx), "remember", { fact: "Student of Marketing (A)" });
    expect(ctx.session.memory()).toEqual(["Student of Marketing (A)"]);
    expect(ctx.session.dirty).toBe(true);
  });
});

describe("fetchUrl tool", () => {
  function fetchToolset(overrides: Partial<ToolRuntimeContext> = {}) {
    const made = makeContext({
      assistant: makeAssistant({ tools: { builtIns: { fetchUrl: true } } }),
      ...overrides,
    });
    return { ...made, toolset: buildToolset(made.ctx) };
  }

  it("refuses private/localhost hosts without fetching", async () => {
    const { toolset } = fetchToolset();
    for (const url of [
      "http://localhost:3000/x",
      "http://127.0.0.1/x",
      "http://10.0.0.8/x",
      "http://192.168.1.1/x",
      "http://172.20.1.1/x",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/x",
      "http://[fd00::1]/x",
      "http://[::ffff:10.0.0.1]/x",
    ]) {
      const output = (await run(toolset, "fetchUrl", { url })) as { error?: string };
      expect(output.error).toContain("not reachable");
    }
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("refuses a hostname that resolves to a private address", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "10.0.0.5", family: 4 },
    ] as never);
    const { toolset } = fetchToolset();
    const output = (await run(toolset, "fetchUrl", {
      url: "https://internal.example/admin",
    })) as { error?: string };
    expect(output.error).toContain("not reachable");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("refuses a decimal IPv4 literal that resolves to loopback", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "127.0.0.1", family: 4 },
    ] as never);
    const { toolset } = fetchToolset();
    const output = (await run(toolset, "fetchUrl", {
      url: "http://2130706433/",
    })) as { error?: string };
    expect(output.error).toContain("not reachable");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("does not follow a redirect into a private target", async () => {
    requestMock.mockResolvedValueOnce(
      pinnedResponse(302, { location: "http://169.254.169.254/latest/meta-data" })
    );
    const { toolset } = fetchToolset();
    const output = (await run(toolset, "fetchUrl", {
      url: "https://public.example/start",
    })) as { error?: string };
    expect(output.error).toContain("not reachable");
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it("strips HTML and truncates long content", async () => {
    const html = `<html><head><style>p{}</style><script>evil()</script></head><body><p>Hello&nbsp;world</p>${"x".repeat(7000)}</body></html>`;
    requestMock.mockResolvedValueOnce(
      pinnedResponse(200, { "content-type": "text/html" }, html)
    );
    const { toolset } = fetchToolset();
    const output = (await run(toolset, "fetchUrl", {
      url: "https://example.edu/page",
    })) as { content: string; truncated: boolean };
    expect(output.content).toContain("Hello world");
    expect(output.content).not.toContain("evil()");
    expect(output.content.length).toBeLessThanOrEqual(6000);
    expect(output.truncated).toBe(true);
  });

  it("reports HTTP failures as tool errors", async () => {
    requestMock.mockResolvedValueOnce(pinnedResponse(503, {}, "nope"));
    const { toolset } = fetchToolset();
    const output = (await run(toolset, "fetchUrl", {
      url: "https://example.edu/down",
    })) as { error: string };
    expect(output.error).toContain("503");
  });
});

/**
 * The API catalogue's query tool against the REAL egress guard (only DNS and the
 * pinned transport are mocked). api-integration.security.test.ts stubs
 * `egressFetch` to pin the catalogue-before-network ordering; these two cases
 * are the other half — that a described, catalogue-approved endpoint is still
 * subject to the guard. They came from the per-endpoint custom tools the
 * contract step of spec #559 deleted; the properties outlived them.
 */
describe("API catalogue query — egress containment", () => {
  const integration: ApiIntegration = {
    assistantId: "assistant-1",
    organizationId: "org-1",
    name: "Service desk",
    baseUrl: "https://api.example.com/v1",
    authType: "none",
    authHeaderName: "",
    authUsername: "",
    encryptedCredential: null,
    endpoints: [
      {
        id: "comments",
        name: "Ticket comments",
        path: "/tickets/{ticketId}/comments",
        method: "GET",
        purpose: "The comments on one ticket.",
      },
    ],
    createdAt: "2026-07-30T00:00:00Z",
    updatedAt: "2026-07-30T00:00:00Z",
  };

  it("queries a described endpoint through the guard", async () => {
    requestMock.mockResolvedValueOnce(
      pinnedResponse(200, {}, JSON.stringify({ items: [] }))
    );
    const { ctx } = makeContext({ apiIntegration: integration });
    const output = (await run(buildToolset(ctx), "queryApi", {
      path: "/tickets/8317/comments",
    })) as { status?: number; data?: unknown };
    expect(output.status).toBe(200);
    expect(requestMock.mock.calls[0][0].url.toString()).toBe(
      "https://api.example.com/v1/tickets/8317/comments"
    );
  });

  it("refuses an endpoint that resolves to a private address", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "10.0.0.5", family: 4 },
    ] as never);
    const { ctx } = makeContext({ apiIntegration: integration });
    const output = (await run(buildToolset(ctx), "queryApi", {
      path: "/tickets/8317/comments",
    })) as { error?: string };
    expect(output.error).toContain("not reachable");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("fails instead of following a redirect", async () => {
    requestMock.mockResolvedValueOnce(
      pinnedResponse(302, { location: "http://10.0.0.5/steal" })
    );
    const { ctx } = makeContext({ apiIntegration: integration });
    const output = (await run(buildToolset(ctx), "queryApi", {
      path: "/tickets/8317/comments",
    })) as { error?: string };
    expect(output.error).toContain("not reachable");
    expect(requestMock).toHaveBeenCalledOnce();
  });
});
