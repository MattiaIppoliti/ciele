import { z } from "zod";
import {
  apiCatalogSummary,
  apiEndpointDetail,
  type ApiIntegration,
  type KnowledgeSearchResult,
} from "@agent-hub/core";
import {
  API_QUERY_ERROR_MESSAGES,
  queryApiEndpoint,
  type ApiQueryOutcome,
} from "./api-integration";
import {
  MAX_READ_WINDOW_CHARS,
  readWindow,
  readWindowNote,
} from "./windowed-read";
import type { RuntimeToolSpec, ToolRuntimeContext } from "./tools";

/**
 * The API catalogue's model-facing surface (spec #559): **three generic tools
 * over one described catalogue**, plus the two windowed readers.
 *
 * The shape is the point. A per-endpoint custom tool forces the whole catalogue
 * into the system prompt and gives the model no way to ask for a contract it
 * did not get; three tools over a catalogue let it discover what exists, read
 * the contracts it needs (in parallel — the description says so), substitute
 * path parameters from the conversation, and page through a response too large
 * to read at once.
 *
 * Every one of these is a plain `RuntimeToolSpec`, so it goes through
 * `instrument()` in tools.ts for its lifecycle events, error containment and
 * budget note like any other tool — there is no bespoke event emission here.
 * The query tool additionally records the `endpoint / method / status /
 * response` quadruple the Inbox renders as a card.
 */

/** How much of a response body the query tool hands back before paging kicks in. */
const QUERY_INLINE_CHARS = 4_000;
/** Responses kept for windowed reads this turn — bounded, per turn, in memory. */
const MAX_RETAINED_RESPONSES = 8;

/** One stored API response, readable in windows by handle for the rest of the turn. */
export interface RetainedApiResponse {
  handle: string;
  endpointName: string;
  method: string;
  path: string;
  body: string;
}

/** The per-turn response store the query tool writes and the reader reads. */
export interface ApiResponseStore {
  put(entry: Omit<RetainedApiResponse, "handle">): RetainedApiResponse;
  get(handle: string): RetainedApiResponse | null;
  handles(): string[];
}

/**
 * A fresh store for one turn. In memory on purpose: a 200k-character body is
 * read within the turn that fetched it, and persisting it would put a full API
 * response — student names and grades included — into the conversation's
 * session state.
 */
export function createApiResponseStore(): ApiResponseStore {
  const entries = new Map<string, RetainedApiResponse>();
  let seq = 0;
  return {
    put(entry) {
      seq += 1;
      const stored: RetainedApiResponse = { ...entry, handle: `api_${seq}` };
      entries.set(stored.handle, stored);
      // Oldest out first: the model pages through what it just fetched, so the
      // cap protects memory without taking away what it is actually reading.
      if (entries.size > MAX_RETAINED_RESPONSES) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      return stored;
    },
    get(handle) {
      return entries.get(String(handle ?? "").trim()) ?? null;
    },
    handles() {
      return [...entries.keys()];
    },
  };
}

function requireIntegration(
  ctx: ToolRuntimeContext
): ApiIntegration | { error: string } {
  const integration = ctx.apiIntegration;
  if (!integration || integration.endpoints.length === 0) {
    return { error: API_QUERY_ERROR_MESSAGES.not_configured };
  }
  return integration;
}

const getApiDetailsSpec: RuntimeToolSpec = {
  name: "getApiDetails",
  description:
    "List the API endpoints this assistant can query: the base URL plus every endpoint with its purpose, parameters and response keys. Call this first when a question needs live data from the connected API.",
  inputSchema: z.object({}),
  label: () => "Getting a summary of available API endpoints",
  summarize: (output) => {
    const o = output as { error?: string; endpoints?: unknown[] };
    if (o?.error) return o.error;
    const count = o?.endpoints?.length ?? 0;
    return `${count} endpoint${count === 1 ? "" : "s"} available`;
  },
  async execute(_input, ctx) {
    const integration = requireIntegration(ctx);
    if ("error" in integration) return integration;
    const summary = apiCatalogSummary(integration);
    return {
      ...summary,
      note: "Call viewEndpointDetails for every endpoint you expect to need — you can request them in parallel — then queryApi with a relative path.",
    };
  },
};

const viewEndpointDetailsSpec: RuntimeToolSpec = {
  name: "viewEndpointDetails",
  description:
    "Read one endpoint's full contract: every parameter with its type and whether it is required, and the keys the response carries. Request the details of every endpoint you expect to need — you may call this in parallel for several of them.",
  inputSchema: z.object({
    endpointId: z
      .string()
      .describe("The endpoint id or path from getApiDetails"),
  }),
  label: (input) =>
    `Getting detailed information about endpoint: ${String(input.endpointId ?? "")}`,
  summarize: (output) => {
    const o = output as { error?: string; method?: string; path?: string };
    return o?.error ?? (o?.path ? `${o.method} ${o.path}` : "Done");
  },
  async execute(input, ctx) {
    const integration = requireIntegration(ctx);
    if ("error" in integration) return integration;
    const wanted = String(input.endpointId ?? "").trim();
    // Models cite an endpoint by whichever handle is most salient in the
    // catalogue they just read — its id, its path, or its name. All three
    // resolve rather than costing an iteration on a lookup failure.
    const endpoint = integration.endpoints.find(
      (e) =>
        e.id === wanted ||
        e.path === wanted ||
        e.name === wanted ||
        `${e.method} ${e.path}` === wanted
    );
    if (!endpoint) {
      return {
        error: `No endpoint “${wanted}” in this integration. Call getApiDetails for the list.`,
      };
    }
    return apiEndpointDetail(endpoint);
  },
};

/** The synthetic Source a queried endpoint contributes, so an answer can cite it. */
function apiSource(
  integration: ApiIntegration,
  outcome: ApiQueryOutcome
): KnowledgeSearchResult | null {
  if (!outcome.endpoint) return null;
  return {
    // Namespaced so it can never collide with a real Concept id, and stable per
    // endpoint so two queries of the same endpoint cite once (dedupSources).
    conceptId: `api:${integration.assistantId}:${outcome.endpoint.id}`,
    conceptTitle: outcome.endpoint.name,
    conceptPath: outcome.endpoint.path,
    collectionId: "",
    collectionName: integration.name,
    sourceName: outcome.endpoint.name,
    // Deliberately no URL: the citation names the endpoint, it does not hand a
    // visitor an internal API address to click.
    resourceUrl: null,
    content: "",
    similarity: 1,
  };
}

const queryApiSpec: RuntimeToolSpec = {
  name: "queryApi",
  description:
    "Query one endpoint from the catalogue. Pass a RELATIVE path with the path parameters already substituted (e.g. /tickets/8317/comments) — the base URL is added for you. A path the catalogue does not describe is refused.",
  inputSchema: z.object({
    path: z
      .string()
      .describe(
        "Relative path with {placeholders} replaced by real values, e.g. /tickets/8317/comments"
      ),
    method: z
      .string()
      .optional()
      .describe("HTTP method, when the endpoint declares more than GET"),
    query: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .describe("Query parameters the endpoint declares"),
    body: z.unknown().optional().describe("JSON body, for a write endpoint"),
  }),
  label: (input) => `Querying ${String(input.path ?? "")}`,
  summarize: (output) => {
    const o = output as {
      error?: string;
      status?: number;
      endpoint?: string;
      method?: string;
      path?: string;
    };
    const call = [o?.method, o?.path].filter(Boolean).join(" ");
    if (o?.status !== undefined) {
      return [call, `${o.status}`].filter(Boolean).join(" — ");
    }
    return o?.error || call || "Done";
  },
  async execute(input, ctx) {
    const integration = requireIntegration(ctx);
    if ("error" in integration) return integration;
    const outcome = await queryApiEndpoint(
      integration,
      {
        path: String(input.path ?? ""),
        method: input.method === undefined ? undefined : String(input.method),
        query: input.query as Record<string, string | number | boolean>,
        body: input.body,
      },
      ctx.signal,
      ctx.toolSubject?.type === "sso" && ctx.toolSubject.subjectId
        ? {
            subjectId: ctx.toolSubject.subjectId,
            claimValue: ctx.toolSubject.claimValue,
          }
        : undefined
    );

    // A refusal or a transport failure: no status to report, so the model gets
    // the reason and the card shows the call that never completed.
    if (outcome.errorCode) {
      const error = API_QUERY_ERROR_MESSAGES[outcome.errorCode];
      ctx.recordResult?.({
        endpoint: outcome.endpoint?.name ?? String(input.path ?? ""),
        method: outcome.endpoint?.method ?? "GET",
        path: String(input.path ?? ""),
        status: "failed",
        response: error,
      });
      return { error, path: String(input.path ?? "") };
    }

    const body = outcome.bodyText ?? "";
    const stored = ctx.apiResponses?.put({
      endpointName: outcome.endpoint?.name ?? "endpoint",
      method: outcome.endpoint?.method ?? "GET",
      path: String(input.path ?? ""),
      body,
    });
    const window = readWindow(body, 0, QUERY_INLINE_CHARS);

    ctx.recordResult?.({
      endpoint: outcome.endpoint?.name ?? "endpoint",
      method: outcome.endpoint?.method ?? "GET",
      path: outcome.requestUrl ?? String(input.path ?? ""),
      status: outcome.status ?? null,
      ok: outcome.ok,
      response: window.content,
      totalLength: body.length,
    });

    // A queried endpoint is a citable Source — the reference platform shows a
    // synthetic source name beside its knowledge citations — but only when the
    // call actually succeeded.
    if (outcome.ok) {
      const source = apiSource(integration, outcome);
      if (source) ctx.usedSources.push(source);
    }

    // JSON when it parses, raw text when it does not — a non-JSON body is data,
    // not an error, and the model is told which it got.
    let data: unknown = window.content;
    let parsed = false;
    if (window.nextFrom === null) {
      try {
        data = JSON.parse(body);
        parsed = true;
      } catch {
        parsed = false;
      }
    }
    return {
      endpoint: outcome.endpoint?.name,
      method: outcome.endpoint?.method,
      path: String(input.path ?? ""),
      status: outcome.status,
      ok: outcome.ok,
      format: parsed ? "json" : "text",
      data,
      totalLength: body.length,
      ...(window.nextFrom !== null && stored
        ? {
            handle: stored.handle,
            note: `${readWindowNote(window, `API response ${stored.handle}`)} Use readApiResponse with this handle.`,
          }
        : {}),
      ...(outcome.ok
        ? {}
        : {
            note: `The API answered ${outcome.status}. Tell the user honestly if this means you cannot answer.`,
          }),
    };
  },
};

const readApiResponseSpec: RuntimeToolSpec = {
  name: "readApiResponse",
  description:
    "Read more of a large API response, by the handle a previous queryApi returned. Returns the requested character window plus the response's total length.",
  inputSchema: z.object({
    handle: z.string().describe("The handle from queryApi, e.g. api_1"),
    from: z.number().optional().describe("First character to read (default 0)"),
    to: z
      .number()
      .optional()
      .describe(
        `Character to read up to; at most ${MAX_READ_WINDOW_CHARS} characters come back per call`
      ),
  }),
  label: (input) => `Reading more from API response ${String(input.handle ?? "")}`,
  summarize: (output) => {
    const o = output as { error?: string; from?: number; to?: number; totalLength?: number };
    if (o?.error) return o.error;
    return `Read characters ${o?.from}-${o?.to} of ${o?.totalLength}`;
  },
  async execute(input, ctx) {
    const handle = String(input.handle ?? "").trim();
    const stored = ctx.apiResponses?.get(handle);
    if (!stored) {
      const open = ctx.apiResponses?.handles() ?? [];
      return {
        error: open.length
          ? `No API response “${handle}” in this turn. Open handles: ${open.join(", ")}.`
          : `No API response “${handle}” in this turn — query an endpoint first.`,
      };
    }
    const window = readWindow(stored.body, input.from as number, input.to as number);
    return {
      handle: stored.handle,
      endpoint: stored.endpointName,
      from: window.from,
      to: window.to,
      totalLength: window.totalLength,
      content: window.content,
      nextFrom: window.nextFrom,
      note: readWindowNote(window, `API response ${stored.handle}`),
    };
  },
};

const readKnowledgeSourceSpec: RuntimeToolSpec = {
  name: "readKnowledgeSource",
  description:
    "Read a knowledge document in character windows, by the sourceId a knowledge search returned. Use it when a search result is cut off mid-answer and you need the surrounding text. Returns the window plus the document's total length.",
  inputSchema: z.object({
    sourceId: z
      .string()
      .describe("The sourceId from a searchKnowledge result"),
    from: z.number().optional().describe("First character to read (default 0)"),
    to: z
      .number()
      .optional()
      .describe(
        `Character to read up to; at most ${MAX_READ_WINDOW_CHARS} characters come back per call`
      ),
  }),
  label: (input) => {
    const from = Number(input.from ?? 0);
    const to = input.to === undefined ? from + MAX_READ_WINDOW_CHARS : Number(input.to);
    return `Reading characters ${from}-${to} from source ${String(input.sourceId ?? "")}`;
  },
  summarize: (output) => {
    const o = output as { error?: string; from?: number; to?: number; totalLength?: number };
    if (o?.error) return o.error;
    return `Read characters ${o?.from}-${o?.to} of ${o?.totalLength}`;
  },
  async execute(input, ctx) {
    const sourceId = String(input.sourceId ?? "").trim();
    if (!sourceId) return { error: "No sourceId was given." };
    if (!ctx.readKnowledgeDocument) {
      return { error: "Reading knowledge documents is not available here." };
    }
    const document = await ctx.readKnowledgeDocument(sourceId);
    if (!document) {
      return {
        error: `The document “${sourceId}” is not readable by this assistant. Use a sourceId from a knowledge search result.`,
      };
    }
    const window = readWindow(
      document.text,
      input.from as number,
      input.to as number
    );
    return {
      sourceId,
      title: document.title,
      source: document.sourceName,
      from: window.from,
      to: window.to,
      totalLength: window.totalLength,
      content: window.content,
      nextFrom: window.nextFrom,
      note: readWindowNote(window, `“${document.title}”`),
    };
  },
};

/**
 * The catalogue tools, in the order the model is meant to reach for them.
 * `readKnowledgeSource` is separate: it belongs to knowledge, not to the API
 * integration, so it is registered whenever a document reader is wired.
 */
export const API_CATALOG_SPECS: RuntimeToolSpec[] = [
  getApiDetailsSpec,
  viewEndpointDetailsSpec,
  queryApiSpec,
  readApiResponseSpec,
];

export const READ_KNOWLEDGE_SOURCE_SPEC = readKnowledgeSourceSpec;
