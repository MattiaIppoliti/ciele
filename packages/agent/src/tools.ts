import { tool, type Tool, type ToolSet } from "ai";
import { z } from "zod";
import type {
  ApiIntegration,
  Assistant,
  KnowledgeSearchResult,
} from "@agent-hub/core";
import type { TurnSession } from "./session";
import type { KnowledgeDocument, KnowledgeSearcher, RuntimeEvent } from "./types";
import {
  MAX_SEARCH_PASSES,
  readyToAnswerTool,
  runSearchPass,
  withBudgetNote,
  type LoopBudget,
  type SearchPass,
  type TerminalState,
  type WriteTimeStyle,
} from "./agentic-search";
import { EgressPolicyError, egressFetch } from "./egress";
import {
  API_CATALOG_SPECS,
  READ_KNOWLEDGE_SOURCE_SPEC,
  type ApiResponseStore,
} from "./api-catalog-tools";

/**
 * Runtime Tool Registry — the pluggable tool surface of the agent loop
 * (tau-style "tools"). A tool is a spec: name, description, zod input schema,
 * a human-readable step label, and an execute. `buildToolset` assembles the
 * turn's ToolSet from the built-ins (gated per assistant via
 * `assistant.tools.builtIns`), the assistant's API catalogue integration when
 * one is registered, and the windowed knowledge reader when a document reader is
 * wired — wrapping every execute with the tool-start/tool-end lifecycle events,
 * so a new tool gets structured Thinking-panel progress for free. The one
 * exception is `searchKnowledge`,
 * whose lifecycle (and error containment for a throwing searcher) lives in the
 * shared search-pass primitive instead (agentic-search/, #204) so seeded and
 * model-driven passes cannot drift.
 *
 * Built-in defaults: `searchKnowledge` is always on (grounding is a runtime
 * invariant, ADR-0002); `remember` defaults on; `fetchUrl` defaults OFF
 * (network egress is opt-in per assistant).
 */

export interface ToolRuntimeContext {
  assistant: Assistant;
  session: TurnSession;
  searchKnowledge?: KnowledgeSearcher;
  /**
   * Reads one knowledge document whole, for the windowed `readKnowledgeSource`
   * reader. A port rather than a `Db` handle, like `searchKnowledge` — absent
   * leaves the reader unregistered (nothing to read from).
   */
  readKnowledgeDocument?: (id: string) => Promise<KnowledgeDocument | null>;
  /**
   * The Assistant's API catalogue integration (spec #559), credential still
   * sealed. Absent/empty leaves the three catalogue tools unregistered — an
   * assistant with no integration should not be told an API exists.
   */
  apiIntegration?: ApiIntegration | null;
  /** Per-turn store of fetched API responses, read in windows by handle. */
  apiResponses?: ApiResponseStore;
  /**
   * Records the structured result this tool call wants on the transcript, as
   * labelled rows rather than a one-line summary (the API card's
   * endpoint/method/status/response). Bound per call by {@link instrument}; a
   * spec calls it, never the other way round.
   */
  recordResult?: (result: Record<string, unknown>) => void;
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
  /**
   * The agent loop's iteration budget (#558). Every tool result carries its
   * escalating note, so the model plans against the limit instead of being cut
   * off by it. Absent in the deterministic no-model path and in pure tests.
   */
  loop?: LoopBudget;
  /**
   * The turn's terminal declaration (#558). Present makes `readyToAnswer`
   * available and mandatory; absent leaves the toolset as a pure gather set
   * (the deterministic no-model path, and tests that only exercise one tool).
   */
  terminal?: TerminalState;
  /** Answering-style instructions, late-bound onto the terminal tool's result. */
  writeTimeStyle?: WriteTimeStyle;
  emit: (event: RuntimeEvent) => void;
  signal?: AbortSignal;
}

/** One registry entry; `execute` returns the value handed back to the model. */
export interface RuntimeToolSpec {
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
/** Queries one `searchKnowledge` call may batch (#558). */
export const MAX_QUERIES_PER_SEARCH = 4;

/**
 * Normalizes what the model actually sent into a query list. The schema asks
 * for an array, but models reliably send a bare string for a single query, and
 * refusing it would spend an iteration on a validation error instead of a
 * search. Empty entries are dropped; the batch is capped.
 */
export function normalizeSearchQueries(input: {
  queries?: unknown;
  query?: unknown;
}): string[] {
  const raw = input.queries ?? input.query;
  const list = Array.isArray(raw) ? raw : [raw];
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const entry of list) {
    const query = String(entry ?? "").trim();
    if (!query || seen.has(query)) continue;
    seen.add(query);
    queries.push(query);
    if (queries.length >= MAX_QUERIES_PER_SEARCH) break;
  }
  return queries;
}

function searchKnowledgeTool(ctx: ToolRuntimeContext): Tool {
  return tool({
    description:
      "Search the assistant's knowledge base for facts relevant to the user's question. Pass several queries at once when a question has several parts — they run together and cost one iteration.",
    // Both shapes are accepted on purpose. Schema validation runs BEFORE
    // execute, so a model that sends the single-query form — a stale cached
    // prompt, or just a model that ignores the array — would otherwise spend a
    // whole iteration on a validation error instead of a search.
    inputSchema: z.object({
      queries: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          `What to search for — up to ${MAX_QUERIES_PER_SEARCH} distinct queries in one call`
        ),
      query: z
        .string()
        .optional()
        .describe("A single search query; prefer `queries`"),
    }),
    execute: async (input: { queries?: unknown; query?: unknown }, options) => {
      // One call is one iteration however many queries it batches — that is the
      // whole incentive for batching.
      ctx.loop?.spend();
      const queries = normalizeSearchQueries(input);
      const budget = ctx.searchBudget ?? MAX_SEARCH_PASSES;
      if (queries.length === 0) {
        return withBudgetNote(
          { error: "No search query was provided." },
          ctx.loop
        );
      }
      // The batch is ONE panel row (and one iteration): the model made one
      // decision, so the pass primitive runs with its lifecycle suppressed and
      // the label lists the queries the way the reference transcript does.
      const callId = options?.toolCallId ?? `search-batch-${Date.now()}`;
      const startedAt = Date.now();
      ctx.emit({
        type: "tool-start",
        callId,
        tool: "searchKnowledge",
        label:
          queries.length === 1
            ? `Searching knowledge for “${queries[0]}”`
            : `Searching knowledge for:\n${queries.map((q) => `- ${q}`).join("\n")}`,
        input: { queries },
        iteration: ctx.loop?.iteration,
      });
      const end = (ok: boolean, summary: string) =>
        ctx.emit({
          type: "tool-end",
          callId,
          tool: "searchKnowledge",
          ok,
          summary,
          durationMs: Date.now() - startedAt,
        });

      const runtime = {
        searchKnowledge: ctx.searchKnowledge ?? (async () => []),
        passes: ctx.searchPasses,
        usedSources: ctx.usedSources,
        emit: ctx.emit,
        budget,
      };
      const found: KnowledgeSearchResult[] = [];
      let exhausted = false;
      let failure: string | null = null;
      for (const query of queries) {
        const outcome = await runSearchPass(query, "collection", runtime, {
          onError: "report",
          emitLifecycle: false,
        });
        if (outcome.kind === "budget-exhausted") {
          exhausted = true;
          break;
        }
        // A throwing searcher reads to the model like any broken tool — but one
        // failed query in a batch must not discard the ones that worked.
        if (outcome.kind === "failed") {
          failure = outcome.message;
          continue;
        }
        found.push(...outcome.results);
      }

      if (failure && found.length === 0) {
        end(false, failure);
        return withBudgetNote({ error: failure }, ctx.loop);
      }
      // Per-turn search-iteration budget: once spent, refuse further searches
      // so the model answers with what it has — never runs away with
      // cost/latency.
      if (exhausted && found.length === 0) {
        end(true, "No matching knowledge found");
        return withBudgetNote(
          {
            results: [],
            note: `Search budget reached (${budget} searches this turn). Do not search again — answer now with what you already found, and say honestly if it is not enough.`,
          },
          ctx.loop
        );
      }
      if (found.length === 0) {
        end(true, "No matching knowledge found");
        return withBudgetNote(
          {
            results: [],
            note: `No matching knowledge found in "${ctx.assistant.title}"'s knowledge base. Tell the user honestly if you cannot answer from it.`,
          },
          ctx.loop
        );
      }
      end(
        true,
        `Found ${found.length} relevant concept${found.length > 1 ? "s" : ""}`
      );
      return withBudgetNote(
        {
          results: found.map((r) => ({
            concept: r.conceptTitle,
            collection: r.collectionName,
            source: r.sourceName,
            content: r.content,
            // The handle `readKnowledgeSource` reads by: a search returns the
            // matching chunk, and this is how the model asks for the rest of
            // the document that chunk came from.
            ...(ctx.readKnowledgeDocument ? { sourceId: r.conceptId } : {}),
          })),
          ...(exhausted
            ? {
                note: `Search budget reached (${budget} searches this turn). Do not search again.`,
              }
            : {}),
        },
        ctx.loop
      );
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

let callSeq = 0;

/**
 * Wraps a spec into an AI-SDK tool whose execute emits the
 * tool-start/tool-end lifecycle: structured payloads (tool name, model input,
 * outcome summary, duration) instead of label-only steps. A throwing execute
 * becomes an `{ error }` result for the model plus an `ok: false` tool-end —
 * one broken tool never aborts the turn.
 *
 * A spec that wants more than a one-line summary on the transcript (the API
 * card's endpoint/method/status/response) calls `ctx.recordResult`. The recorder
 * is bound to THIS call on a cloned context, because tools genuinely run
 * concurrently — the endpoint-detail tool is described as parallel-callable, and
 * one step's parallel calls cost one iteration by design — so a shared slot
 * would attribute one call's result to another.
 */
function instrument(spec: RuntimeToolSpec, ctx: ToolRuntimeContext): Tool {
  return tool({
    description: spec.description,
    inputSchema: spec.inputSchema,
    execute: async (input: Record<string, unknown>, options) => {
      const callId = options?.toolCallId ?? `call-${++callSeq}`;
      const startedAt = Date.now();
      ctx.loop?.spend();
      ctx.emit({
        type: "tool-start",
        callId,
        tool: spec.name,
        label: spec.label(input),
        input,
        iteration: ctx.loop?.iteration,
      });
      let recorded: Record<string, unknown> | undefined;
      const callCtx: ToolRuntimeContext = {
        ...ctx,
        recordResult: (result) => {
          recorded = result;
        },
      };
      try {
        const output = await spec.execute(input, callCtx);
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
          result: recorded,
          durationMs: Date.now() - startedAt,
        });
        return withBudgetNote(output, ctx.loop);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Tool call failed";
        ctx.emit({
          type: "tool-end",
          callId,
          tool: spec.name,
          ok: false,
          summary: message,
          result: recorded,
          durationMs: Date.now() - startedAt,
        });
        return withBudgetNote({ error: message }, ctx.loop);
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
  // Windowed knowledge reads: available whenever the host wired a document
  // reader, integration or not — a long Source is a knowledge concern.
  if (ctx.readKnowledgeDocument) {
    toolset[READ_KNOWLEDGE_SOURCE_SPEC.name] = instrument(
      READ_KNOWLEDGE_SOURCE_SPEC,
      ctx
    );
  }
  // The API catalogue triad + its response reader (spec #559). Registered only
  // with a described catalogue behind them: an assistant with no integration
  // must not be told an API exists. This is the ONLY way an org reaches its own
  // HTTP API from a turn — the per-endpoint custom tools it replaced are gone.
  if (ctx.apiIntegration && ctx.apiIntegration.endpoints.length > 0) {
    for (const spec of API_CATALOG_SPECS) {
      toolset[spec.name] = instrument(spec, ctx);
    }
  }
  // The terminal tool — mandatory when a turn has a terminal declaration to
  // make. Not instrumented: declaring you are done spends no iteration, and its
  // result is the write-time instruction the model then acts on.
  if (ctx.terminal) {
    toolset.readyToAnswer = readyToAnswerTool(
      ctx.terminal,
      ctx.writeTimeStyle ?? {},
      (label) => ctx.emit({ type: "thought", text: label })
    );
  }
  return toolset;
}
