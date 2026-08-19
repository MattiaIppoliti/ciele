import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiIntegration, Assistant } from "@agent-hub/core";

vi.mock("./egress", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./egress")>()),
  egressFetch: vi.fn(),
}));

import { egressFetch } from "./egress";
import { createTurnSession } from "./session";
import { buildToolset, type ToolRuntimeContext } from "./tools";
import { createApiResponseStore } from "./api-catalog-tools";
import { MAX_READ_WINDOW_CHARS } from "./windowed-read";
import type { KnowledgeDocument, RuntimeEvent } from "./types";

/**
 * The API catalogue's model-facing behaviour (spec #559): discovery → endpoint
 * detail → query in three iterations, windowed reads over a large response and
 * over a long knowledge document, the synthetic Source a queried endpoint
 * contributes, and the endpoint/method/status/response quadruple the Inbox card
 * renders. The egress-ordering guarantees live in
 * api-integration.security.test.ts.
 */

const egressFetchMock = vi.mocked(egressFetch);

function response(text: string, status = 200) {
  return {
    response: {
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers(),
      text,
    },
    finalUrl: "https://api.example.com/",
  };
}

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

const INTEGRATION: ApiIntegration = {
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
      params: [
        { name: "ticketId", in: "path", type: "number", description: "ticket identifier" },
        { name: "limit", in: "query", type: "number" },
      ],
      responseKeys: ["items", "total"],
    },
    {
      id: "attachments",
      name: "Ticket attachments",
      path: "/tickets/{ticketId}/attachments",
      method: "GET",
      purpose: "The files attached to one ticket.",
    },
  ],
  createdAt: "2026-07-30T00:00:00Z",
  updatedAt: "2026-07-30T00:00:00Z",
};

function makeContext(overrides: Partial<ToolRuntimeContext> = {}) {
  const events: RuntimeEvent[] = [];
  const ctx: ToolRuntimeContext = {
    assistant: makeAssistant(),
    session: createTurnSession("c1", {}),
    usedSources: [],
    searchPasses: [],
    apiIntegration: INTEGRATION,
    apiResponses: createApiResponseStore(),
    emit: (e) => events.push(e),
    ...overrides,
  };
  return { ctx, events };
}

async function run(
  toolset: ReturnType<typeof buildToolset>,
  name: string,
  input: Record<string, unknown> = {}
) {
  const entry = toolset[name] as {
    execute: (i: unknown, o: unknown) => Promise<unknown>;
  };
  // A distinct call id per invocation, the way the AI SDK supplies one.
  return entry.execute(input, {
    toolCallId: `call-${Math.abs(name.length + Object.keys(input).length)}-${name}`,
    messages: [],
  });
}

beforeEach(() => {
  egressFetchMock.mockReset();
  egressFetchMock.mockResolvedValue(response("{}") as never);
});

describe("registration", () => {
  it("registers the triad and the response reader only with a catalogue", () => {
    const { ctx } = makeContext();
    expect(Object.keys(buildToolset(ctx)).sort()).toEqual([
      "getApiDetails",
      "queryApi",
      "readApiResponse",
      "remember",
      "searchKnowledge",
      "viewEndpointDetails",
    ]);
  });

  it("registers nothing API-shaped without an integration or with an empty catalogue", () => {
    for (const apiIntegration of [
      null,
      { ...INTEGRATION, endpoints: [] },
    ] as (ApiIntegration | null)[]) {
      const { ctx } = makeContext({ apiIntegration });
      expect(Object.keys(buildToolset(ctx))).toEqual([
        "searchKnowledge",
        "remember",
      ]);
    }
  });

  it("registers readKnowledgeSource whenever a document reader is wired", () => {
    const { ctx } = makeContext({
      apiIntegration: null,
      readKnowledgeDocument: async () => null,
    });
    expect(Object.keys(buildToolset(ctx))).toContain("readKnowledgeSource");
  });
});

describe("discovery → detail → query", () => {
  it("answers within three iterations: catalogue, contract, then the call", async () => {
    const { ctx } = makeContext();
    const toolset = buildToolset(ctx);

    const summary = (await run(toolset, "getApiDetails")) as {
      baseUrl: string;
      endpoints: Array<{ id: string; pathParams: string[] }>;
    };
    expect(summary.baseUrl).toBe("https://api.example.com/v1");
    expect(summary.endpoints.map((e) => e.id)).toEqual(["comments", "attachments"]);
    expect(summary.endpoints[0].pathParams).toEqual(["ticketId"]);

    const detail = (await run(toolset, "viewEndpointDetails", {
      endpointId: "comments",
    })) as { parameters: Array<{ name: string; required: boolean }> };
    expect(detail.parameters.map((p) => p.name)).toEqual(["ticketId", "limit"]);
    expect(detail.parameters[0].required).toBe(true);

    egressFetchMock.mockResolvedValueOnce(
      response('{"items":[{"id":1}],"total":1}') as never
    );
    const queried = (await run(toolset, "queryApi", {
      path: "/tickets/8317/comments",
    })) as { status: number; format: string; data: { total: number } };
    expect(queried.status).toBe(200);
    expect(queried.format).toBe("json");
    expect(queried.data.total).toBe(1);
  });

  it("resolves an endpoint cited by path or by name, not only by id", async () => {
    const { ctx } = makeContext();
    const toolset = buildToolset(ctx);
    for (const endpointId of [
      "/tickets/{ticketId}/comments",
      "Ticket comments",
      "GET /tickets/{ticketId}/comments",
    ]) {
      const detail = (await run(toolset, "viewEndpointDetails", { endpointId })) as {
        id?: string;
        error?: string;
      };
      expect(detail.error).toBeUndefined();
      expect(detail.id).toBe("comments");
    }
  });

  it("tells the model plainly when an endpoint is not in the catalogue", async () => {
    const { ctx } = makeContext();
    const detail = (await run(buildToolset(ctx), "viewEndpointDetails", {
      endpointId: "audit-log",
    })) as { error: string };
    expect(detail.error).toMatch(/No endpoint .* Call getApiDetails/);
  });
});

describe("the Inbox card's quadruple", () => {
  it("records endpoint, method, status and response on a success", async () => {
    const { ctx, events } = makeContext();
    egressFetchMock.mockResolvedValueOnce(response('{"items":[]}') as never);
    await run(buildToolset(ctx), "queryApi", { path: "/tickets/8317/comments" });
    const end = events.find(
      (e) => e.type === "tool-end" && e.tool === "queryApi"
    ) as Extract<RuntimeEvent, { type: "tool-end" }>;
    expect(end.ok).toBe(true);
    expect(end.summary).toBe("GET /tickets/8317/comments, 200");
    expect(end.result).toMatchObject({
      endpoint: "Ticket comments",
      method: "GET",
      status: 200,
      ok: true,
      response: '{"items":[]}',
    });
  });

  it("records a real 500 with its body, as a completed call", async () => {
    const { ctx, events } = makeContext();
    egressFetchMock.mockResolvedValueOnce(
      response("<html>Internal Server Error</html>", 500) as never
    );
    const result = (await run(buildToolset(ctx), "queryApi", {
      path: "/tickets/8317/comments",
    })) as { status: number; ok: boolean; format: string; note: string };
    // A non-JSON body is data, not an error, the model is told which it got.
    expect(result.status).toBe(500);
    expect(result.ok).toBe(false);
    expect(result.format).toBe("text");
    expect(result.note).toMatch(/answered 500/);
    const end = events.find(
      (e) => e.type === "tool-end" && e.tool === "queryApi"
    ) as Extract<RuntimeEvent, { type: "tool-end" }>;
    expect(end.result).toMatchObject({
      status: 500,
      ok: false,
      response: "<html>Internal Server Error</html>",
    });
  });

  it("records a refused path as a failed call, with no status to fake", async () => {
    const { ctx, events } = makeContext();
    const result = (await run(buildToolset(ctx), "queryApi", {
      path: "/tickets/8317/audit-log",
    })) as { error: string };
    expect(egressFetchMock).not.toHaveBeenCalled();
    expect(result.error).toMatch(/not in this integration's endpoint catalogue/);
    const end = events.find(
      (e) => e.type === "tool-end" && e.tool === "queryApi"
    ) as Extract<RuntimeEvent, { type: "tool-end" }>;
    expect(end.ok).toBe(false);
    expect(end.result).toMatchObject({ status: "failed" });
  });
});

describe("windowed reads of a large API response", () => {
  const BIG = `{"rows":"${"y".repeat(200_000)}"}`;

  it("hands back a handle and the total length, then pages to the end", async () => {
    const { ctx } = makeContext();
    const toolset = buildToolset(ctx);
    egressFetchMock.mockResolvedValueOnce(response(BIG) as never);
    const queried = (await run(toolset, "queryApi", {
      path: "/tickets/8317/comments",
    })) as { handle: string; totalLength: number; note: string; format: string };
    expect(queried.totalLength).toBe(BIG.length);
    expect(queried.handle).toBe("api_1");
    expect(queried.note).toMatch(/readApiResponse/);
    // Too large to parse as one payload: the model is told it is a window.
    expect(queried.format).toBe("text");

    let from: number | null = 0;
    let read = 0;
    while (from !== null) {
      const window = (await run(toolset, "readApiResponse", {
        handle: "api_1",
        from,
      })) as { content: string; totalLength: number; nextFrom: number | null };
      expect(window.totalLength).toBe(BIG.length);
      expect(window.content.length).toBeLessThanOrEqual(MAX_READ_WINDOW_CHARS);
      read += window.content.length;
      from = window.nextFrom;
    }
    // The first window came back inline with the query; the reader walked the rest.
    expect(read).toBe(BIG.length);
  });

  it("names the open handles when the model asks for one that does not exist", async () => {
    const { ctx } = makeContext();
    const toolset = buildToolset(ctx);
    const missing = (await run(toolset, "readApiResponse", { handle: "api_9" })) as {
      error: string;
    };
    expect(missing.error).toMatch(/Query an endpoint first/);

    egressFetchMock.mockResolvedValueOnce(response(BIG) as never);
    await run(toolset, "queryApi", { path: "/tickets/8317/comments" });
    const stillMissing = (await run(toolset, "readApiResponse", {
      handle: "api_9",
    })) as { error: string };
    expect(stillMissing.error).toMatch(/Open handles: api_1/);
  });
});

describe("windowed reads of a long knowledge document", () => {
  const LONG = "z".repeat(50_000);
  const document: KnowledgeDocument = {
    id: "concept-1",
    title: "Exam regulations",
    sourceName: "Student Handbook",
    text: LONG,
  };

  it("reads by id and character range, reporting the total length", async () => {
    const { ctx } = makeContext({
      readKnowledgeDocument: async (id) => (id === "concept-1" ? document : null),
    });
    const toolset = buildToolset(ctx);
    const window = (await run(toolset, "readKnowledgeSource", {
      sourceId: "concept-1",
      from: 21_858,
      to: 23_800,
    })) as {
      from: number;
      to: number;
      totalLength: number;
      content: string;
      title: string;
      nextFrom: number;
    };
    expect(window).toMatchObject({
      from: 21_858,
      to: 23_800,
      totalLength: 50_000,
      title: "Exam regulations",
      nextFrom: 23_800,
    });
    expect(window.content).toHaveLength(23_800 - 21_858);
  });

  it("refuses a document this assistant cannot read", async () => {
    const { ctx } = makeContext({ readKnowledgeDocument: async () => null });
    const result = (await run(buildToolset(ctx), "readKnowledgeSource", {
      sourceId: "someone-elses-concept",
    })) as { error: string };
    expect(result.error).toMatch(/not readable by this assistant/);
  });

  it("labels the read the way the reference transcript does", async () => {
    const { ctx, events } = makeContext({
      readKnowledgeDocument: async () => document,
    });
    await run(buildToolset(ctx), "readKnowledgeSource", {
      sourceId: "concept-1",
      from: 0,
      to: 5_000,
    });
    const start = events.find((e) => e.type === "tool-start") as Extract<
      RuntimeEvent,
      { type: "tool-start" }
    >;
    expect(start.label).toBe("Reading characters 0-5000 from source concept-1");
  });
});

describe("API results are citable", () => {
  it("contributes one synthetic Source per queried endpoint, on success only", async () => {
    const { ctx } = makeContext();
    const toolset = buildToolset(ctx);
    egressFetchMock.mockResolvedValue(response('{"items":[]}') as never);
    await run(toolset, "queryApi", { path: "/tickets/8317/comments" });
    await run(toolset, "queryApi", { path: "/tickets/8318/comments" });
    expect(ctx.usedSources).toHaveLength(2);
    expect(ctx.usedSources[0]).toMatchObject({
      conceptTitle: "Ticket comments",
      collectionName: "Service desk",
      sourceName: "Ticket comments",
      resourceUrl: null,
    });
    // Same endpoint twice cites once (dedupSources keys on conceptId).
    expect(ctx.usedSources[0].conceptId).toBe(ctx.usedSources[1].conceptId);

    egressFetchMock.mockResolvedValueOnce(response("nope", 500) as never);
    await run(toolset, "queryApi", { path: "/tickets/8319/comments" });
    expect(ctx.usedSources).toHaveLength(2);
  });
});
