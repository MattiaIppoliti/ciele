import { tool, type Tool, type ToolSet } from "ai";
import { z } from "zod";
import type {
  Assistant,
  CustomToolConfig,
  KnowledgeSearchResult,
} from "@agent-hub/db";
import type { TurnSession } from "./session";
import type { KnowledgeSearcher, RuntimeEvent } from "./types";
import { MAX_SEARCH_PASSES, runSearchPass, type SearchPass } from "./agentic-search";
import { EgressPolicyError, egressFetch } from "./egress";

/**
 * Runtime Tool Registry — the pluggable tool surface of the agent loop
 * (tau-style "tools"). A tool is a spec: name, description, zod input schema,
 * a human-readable step label, and an execute. `buildToolset` assembles the
 * turn's ToolSet from the built-ins (gated per assistant via
 * `assistant.tools.builtIns`) plus the assistant's custom HTTP tools, and
 * wraps every execute with the tool-start/tool-end lifecycle events — so a
 * new tool gets structured Thinking-panel progress for free. The one
 * exception is `searchKnowledge`, whose lifecycle (and error containment for
 * a throwing searcher) lives in the shared search-pass primitive instead
 * (agentic-search/, #204) so seeded and model-driven passes cannot drift.
 *
 * Built-in defaults: `searchKnowledge` is always on (grounding is a runtime
 * invariant, ADR-0002); `remember` defaults on; `fetchUrl` defaults OFF
 * (network egress is opt-in per assistant).
 */

export interface ToolRuntimeContext {
  assistant: Assistant;
  session: TurnSession;
  searchKnowledge?: KnowledgeSearcher;
  /** Collector the reply's Sources part is built from (see actions.ts). */
  usedSources: KnowledgeSearchResult[];
  /**
   * Per-turn `searchKnowledge` iteration log (Agentic Search). Each pass the
   * tool runs is appended with its coverage verdict; its length is the
   * search-iteration count the budget gate reads. Owned by the handler.
   */
  searchPasses: SearchPass[];
  /** Max `searchKnowledge` calls this turn (defaults to MAX_SEARCH_PASSES). */
  searchBudget?: number;
  emit: (event: RuntimeEvent) => void;
  signal?: AbortSignal;
}

/** One registry entry; `execute` returns the value handed back to the model. */
interface RuntimeToolSpec {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: z.ZodType<any>;
  label: (input: Record<string, unknown>) => string;
  /** Short outcome line for the tool-end event. */
  summarize?: (output: unknown) => string | undefined;
  execute: (
    input: Record<string, unknown>,
    ctx: ToolRuntimeContext
  ) => Promise<unknown>;
}

const FETCH_TIMEOUT_MS = 10_000;
const FETCH_MAX_CHARS = 6_000;
const FETCH_MAX_RESPONSE_BYTES = 1024 * 1024;
/** One message for every egress-policy block — "blocked" must be indistinguishable from "down". */
const EGRESS_BLOCKED_MESSAGE = "This host is not reachable from the assistant";

/** Crude tag-stripper so HTML pages come back as readable text. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Built-in specs ──────────────────────────────────────────────────────────

/**
 * The searchKnowledge tool is deliberately NOT routed through `instrument`:
 * its lifecycle events, ledger record, coverage verdict and budget gate all
 * live in the shared search-pass primitive (agentic-search/, #204) — the
 * same code the deterministic seed loop runs — so seeded and model-driven
 * passes cannot drift. This adapter only maps the model's input and the
 * primitive's outcome to the model-facing return shape.
 */
function searchKnowledgeTool(ctx: ToolRuntimeContext): Tool {
  return tool({
    description:
      "Search the assistant's knowledge base for facts relevant to the user's question.",
    inputSchema: z.object({ query: z.string().describe("What to search for") }),
    execute: async (input: { query?: unknown }, options) => {
      const query = String(input.query ?? "");
      const budget = ctx.searchBudget ?? MAX_SEARCH_PASSES;
      const outcome = await runSearchPass(
        query,
        // The model's searches run at the turn's anchored tier; the searcher
        // treats "collection" with no anchor as assistant-wide already.
        "collection",
        {
          searchKnowledge: ctx.searchKnowledge ?? (async () => []),
          passes: ctx.searchPasses,
          usedSources: ctx.usedSources,
          emit: ctx.emit,
          budget,
        },
        { callId: options?.toolCallId, onError: "report" }
      );
      // Per-turn search-iteration budget: once spent, refuse further searches
      // so the model answers with what it has — never runs away with
      // cost/latency.
      if (outcome.kind === "budget-exhausted") {
        return {
          results: [],
          note: `Search budget reached (${budget} searches this turn). Do not search again — answer now with what you already found, and say honestly if it is not enough.`,
        };
      }
      // A throwing searcher reads to the model like any broken tool.
      if (outcome.kind === "failed") return { error: outcome.message };
      if (outcome.results.length === 0) {
        return {
          results: [],
          note: `No matching knowledge found in "${ctx.assistant.title}"'s knowledge base. Tell the user honestly if you cannot answer from it.`,
        };
      }
      return {
        results: outcome.results.map((r) => ({
          concept: r.conceptTitle,
          collection: r.collectionName,
          source: r.sourceName,
          content: r.content,
        })),
      };
    },
  });
}

const fetchUrlSpec: RuntimeToolSpec = {
  name: "fetchUrl",
  description:
    "Fetch a public web page or API by URL (GET) and return its text content. Use for live information the knowledge base cannot have.",
  inputSchema: z.object({
    url: z.string().describe("Absolute http(s) URL to fetch"),
  }),
  label: (input) => `Fetching ${String(input.url ?? "")}`,
  summarize: (output) => {
    const o = output as { error?: string; content?: string };
    if (o?.error) return o.error;
    return o?.content !== undefined
      ? `Fetched ${o.content.length} characters`
      : undefined;
  },
  async execute(input, ctx) {
    let url: URL;
    try {
      url = new URL(String(input.url ?? ""));
    } catch {
      return { error: "Invalid URL" };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { error: "Only http(s) URLs are supported" };
    }
    let res;
    try {
      ({ response: res } = await egressFetch(url.toString(), {
        timeoutMs: FETCH_TIMEOUT_MS,
        maxResponseBytes: FETCH_MAX_RESPONSE_BYTES,
        maxRedirects: 3,
        signal: ctx.signal,
        headers: { accept: "text/html, application/json, text/plain, */*" },
      }));
    } catch (error) {
      if (error instanceof EgressPolicyError) {
        return { error: EGRESS_BLOCKED_MESSAGE };
      }
      throw error;
    }
    if (!res.ok) return { error: `Request failed with status ${res.status}` };
    const contentType = res.headers.get("content-type") ?? "";
    const content = contentType.includes("text/html")
      ? htmlToText(res.text)
      : res.text;
    return {
      url: url.toString(),
      truncated: content.length > FETCH_MAX_CHARS,
      content: content.slice(0, FETCH_MAX_CHARS),
    };
  },
};

const rememberSpec: RuntimeToolSpec = {
  name: "remember",
  description:
    "Save a short fact about this user or conversation to the session memory, so later turns in this conversation can use it (e.g. their role, product, account, or preference).",
  inputSchema: z.object({
    fact: z.string().describe("One short self-contained fact to remember"),
  }),
  label: () => "Saving to session memory",
  summarize: () => "Saved",
  async execute(input, ctx) {
    ctx.session.remember(String(input.fact ?? ""));
    return { saved: true };
  },
};

const BUILT_IN_SPECS: RuntimeToolSpec[] = [
  fetchUrlSpec,
  rememberSpec,
];

/** Which built-ins run when the assistant has no explicit override. */
const BUILT_IN_DEFAULTS: Record<string, boolean> = {
  fetchUrl: false,
  remember: true,
};

const TOOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

/** Adapts one admin-defined HTTP tool (assistant.tools.custom) to a spec. */
function customToolSpec(config: CustomToolConfig): RuntimeToolSpec | null {
  if (!TOOL_NAME_RE.test(config.name) || !config.url) return null;
  const params = config.params ?? [];
  const shape: Record<string, z.ZodType> = {};
  for (const param of params) {
    if (!param.name) continue;
    const field = z.string().describe(param.description ?? "");
    shape[param.name] = param.required ? field : field.optional();
  }
  return {
    name: config.name,
    description: config.description || `Call the ${config.name} integration.`,
    inputSchema: z.object(shape),
    label: () => `Calling ${config.name}`,
    summarize: (output) => {
      const o = output as { error?: string };
      return o?.error ?? "Done";
    },
    async execute(input, ctx) {
      const method = config.method === "GET" ? "GET" : "POST";
      const url = new URL(config.url);
      const headers: Record<string, string> = {};
      for (const header of config.headers ?? []) {
        if (header.name) headers[header.name] = header.value;
      }
      let body: string | undefined;
      if (method === "GET") {
        for (const [key, value] of Object.entries(input)) {
          if (value !== undefined) url.searchParams.set(key, String(value));
        }
      } else {
        headers["content-type"] = "application/json";
        body = JSON.stringify(input);
      }
      let res;
      try {
        ({ response: res } = await egressFetch(url.toString(), {
          method,
          headers,
          body,
          timeoutMs: FETCH_TIMEOUT_MS,
          maxResponseBytes: FETCH_MAX_RESPONSE_BYTES,
          signal: ctx.signal,
        }));
      } catch (error) {
        if (error instanceof EgressPolicyError) {
          return { error: EGRESS_BLOCKED_MESSAGE };
        }
        throw error;
      }
      const text = res.text.slice(0, FETCH_MAX_CHARS);
      if (!res.ok) {
        return { error: `Request failed with status ${res.status}`, body: text };
      }
      try {
        return { data: JSON.parse(text) };
      } catch {
        return { data: text };
      }
    },
  };
}

let callSeq = 0;

/**
 * Wraps a spec into an AI-SDK tool whose execute emits the
 * tool-start/tool-end lifecycle: structured payloads (tool name, model input,
 * outcome summary, duration) instead of label-only steps. A throwing execute
 * becomes an `{ error }` result for the model plus an `ok: false` tool-end —
 * one broken tool never aborts the turn.
 */
function instrument(spec: RuntimeToolSpec, ctx: ToolRuntimeContext): Tool {
  return tool({
    description: spec.description,
    inputSchema: spec.inputSchema,
    execute: async (input: Record<string, unknown>, options) => {
      const callId = options?.toolCallId ?? `call-${++callSeq}`;
      const startedAt = Date.now();
      ctx.emit({
        type: "tool-start",
        callId,
        tool: spec.name,
        label: spec.label(input),
        input,
      });
      try {
        const output = await spec.execute(input, ctx);
        const failed =
          typeof output === "object" &&
          output !== null &&
          "error" in output &&
          Boolean((output as { error?: unknown }).error);
        ctx.emit({
          type: "tool-end",
          callId,
          tool: spec.name,
          ok: !failed,
          summary: spec.summarize?.(output),
          durationMs: Date.now() - startedAt,
        });
        return output;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Tool call failed";
        ctx.emit({
          type: "tool-end",
          callId,
          tool: spec.name,
          ok: false,
          summary: message,
          durationMs: Date.now() - startedAt,
        });
        return { error: message };
      }
    },
  });
}

/** Assembles the turn's ToolSet for the agent loop (see module docs above). */
export function buildToolset(ctx: ToolRuntimeContext): ToolSet {
  const overrides = ctx.assistant.tools?.builtIns ?? {};
  const toolset: ToolSet = {
    // Grounding tool — always on (not disableable, ADR-0002); wired straight
    // to the search-pass primitive rather than through `instrument`.
    searchKnowledge: searchKnowledgeTool(ctx),
  };
  for (const spec of BUILT_IN_SPECS) {
    const enabled =
      overrides[spec.name as keyof typeof overrides] ??
      BUILT_IN_DEFAULTS[spec.name];
    if (enabled) toolset[spec.name] = instrument(spec, ctx);
  }
  for (const config of ctx.assistant.tools?.custom ?? []) {
    const spec = customToolSpec(config);
    if (spec && !toolset[spec.name]) toolset[spec.name] = instrument(spec, ctx);
  }
  return toolset;
}
