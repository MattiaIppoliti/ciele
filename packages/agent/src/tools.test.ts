import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Assistant, KnowledgeSearchResult } from "@agent-hub/core";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("./pinned-fetch", () => ({
  pinnedRequest: vi.fn(),
  fetchPinnedPage: vi.fn(),
}));

import { lookup } from "node:dns/promises";
import { pinnedRequest, type PinnedFetchResponse } from "./pinned-fetch";
import { createTurnSession } from "./session";
import { buildToolset, type ToolRuntimeContext } from "./tools";
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

  it("adds valid custom tools and skips invalid names or built-in collisions", () => {
    const { ctx } = makeContext({
      assistant: makeAssistant({
        tools: {
          custom: [
            { id: "1", name: "lookup_course", description: "", url: "https://x.it", method: "GET" },
            { id: "2", name: "bad name!", description: "", url: "https://x.it", method: "GET" },
            { id: "3", name: "no_url", description: "", url: "", method: "GET" },
            { id: "4", name: "remember", description: "", url: "https://x.it", method: "GET" },
          ],
        },
      }),
    });
    const names = Object.keys(buildToolset(ctx)).sort();
    expect(names).toContain("lookup_course");
    expect(names).not.toContain("bad name!");
    expect(names).not.toContain("no_url");
    // built-in wins the name collision
    expect(names.filter((n) => n === "remember")).toHaveLength(1);
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

describe("custom HTTP tools", () => {
  const assistant = makeAssistant({
    tools: {
      custom: [
        {
          id: "1",
          name: "lookup_course",
          description: "Look up a course",
          url: "https://api.example.edu/courses",
          method: "GET",
          headers: [{ id: "h1", name: "x-api-key", value: "k" }],
          params: [{ name: "code", description: "Course code", required: true }],
        },
        {
          id: "2",
          name: "open_ticket",
          description: "",
          url: "https://api.example.edu/tickets",
          method: "POST",
          params: [{ name: "subject", required: true }],
        },
      ],
    },
  });

  it("GET tools pass model params as query string with configured headers", async () => {
    requestMock.mockResolvedValueOnce(
      pinnedResponse(200, {}, JSON.stringify({ name: "Marketing" }))
    );
    const { ctx } = makeContext({ assistant });
    const output = await run(buildToolset(ctx), "lookup_course", { code: "ECO101" });
    expect(output).toEqual({ data: { name: "Marketing" } });
    const [target, options] = requestMock.mock.calls[0];
    expect(target.url.toString()).toBe(
      "https://api.example.edu/courses?code=ECO101"
    );
    expect(options.headers?.["x-api-key"]).toBe("k");
    expect(options.method).toBe("GET");
  });

  it("POST tools send the params as a JSON body", async () => {
    requestMock.mockResolvedValueOnce(pinnedResponse(200, {}, "ok"));
    const { ctx } = makeContext({ assistant });
    const output = await run(buildToolset(ctx), "open_ticket", { subject: "Help" });
    expect(output).toEqual({ data: "ok" });
    const [, options] = requestMock.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(options.body).toBe(JSON.stringify({ subject: "Help" }));
    expect(options.headers?.["content-type"]).toBe("application/json");
  });

  it("refuses an endpoint that resolves to a private address", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "10.0.0.5", family: 4 },
    ] as never);
    const { ctx } = makeContext({ assistant });
    const output = (await run(buildToolset(ctx), "lookup_course", {
      code: "ECO101",
    })) as { error?: string };
    expect(output.error).toContain("not reachable");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("fails instead of following a redirect", async () => {
    requestMock.mockResolvedValueOnce(
      pinnedResponse(302, { location: "http://10.0.0.5/steal" })
    );
    const { ctx } = makeContext({ assistant });
    const output = (await run(buildToolset(ctx), "lookup_course", {
      code: "ECO101",
    })) as { error?: string };
    expect(output.error).toContain("not reachable");
    expect(requestMock).toHaveBeenCalledOnce();
  });
});
