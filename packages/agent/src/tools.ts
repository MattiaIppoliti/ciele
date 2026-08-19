import { tool, type Tool, type ToolSet } from "ai";
import { z } from "zod";
import type {
  ApiIntegration,
  Assistant,
  EntitySnapshot,
  KnowledgeSearchResult,
} from "@agent-hub/core";
import { PROGRESS_MAX_CHARS } from "@agent-hub/core";
import type { TurnSession } from "./session";
import type {
  EntityRecordsFetcher,
  KnowledgeDocument,
  KnowledgeSearcher,
  MemorySearcher,
  RuntimeEvent,
  ToolSubject,
} from "./types";
import { entityToolSpecs } from "./entity-tools";
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
 * Runtime Tool Registry: the pluggable tool surface of the agent loop
 * (tau-style "tools"). A tool is a spec: name, description, zod input schema,
 * a human-readable step label, and an execute. `buildToolset` assembles the
 * turn's ToolSet from the built-ins (gated per assistant via
 * `assistant.tools.builtIns`), the assistant's API catalogue integration when
 * one is registered, and the windowed knowledge reader when a document reader is
 * wired, wrapping every execute with the tool-start/tool-end lifecycle events,
 * so a new tool gets structured Thinking-panel progress, and (when the
 * assistant's Simplified thinking toggle is on) a user-facing narration line,
 * for free. The one exception is `searchKnowledge`, whose lifecycle (and error
 * containment for a throwing searcher) lives in the shared search-pass primitive
 * instead (agentic-search/, #204) so seeded and model-driven passes cannot drift.
 *
 * Built-in defaults: `searchKnowledge` is always on (grounding is a runtime
 * invariant, ADR-0002); `remember` defaults on; `fetchUrl` defaults OFF
 * (network egress is opt-in per assistant).
 */

export interface ToolRuntimeContext {
  assistant: Assistant;
  session: TurnSession;
  searchKnowledge?: KnowledgeSearcher;
  searchMemories?: MemorySearcher;
  entities?: EntitySnapshot[];
  queryEntityRecords?: EntityRecordsFetcher;
  toolSubject?: ToolSubject;
  /**
   * Reads one knowledge document whole, for the windowed `readKnowledgeSource`
   * reader. A port rather than a `Db` handle, like `searchKnowledge`, absent
   * leaves the reader unregistered (nothing to read from).
   */
  readKnowledgeDocument?: (id: string) => Promise<KnowledgeDocument | null>;
  /**
   * The Assistant's API catalogue integration (spec #559), credential still
   * sealed. Absent/empty leaves the three catalogue tools unregistered, an
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
   * Passes claimed by in-flight batches but not yet on the ledger. The AI SDK
   * executes a step's tool calls concurrently, so two simultaneous batches
   * would otherwise read the same ledger length and jointly overshoot the
   * budget; this synchronous claim (single-threaded JS: incremented before any
   * await) is what makes the ceiling hold across them. Lazily initialized by
   * the search tool, absent means no batch is in flight.
   */
  pendingSearchPasses?: { count: number };
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
  /**
   * Simplified thinking (#560). Present = the assistant's toggle is on: every
   * tool's input schema grows an optional `progress` line, and whatever the model
   * writes there is handed here before the call runs, the runtime turns it into
   * a streamed, persisted reply part. Absent = the toggle is off, and neither the
   * schema field nor the narration exists.
   *
   * A callback rather than a boolean because the *collector* belongs to the turn
   * (agentic-search/run.ts), which owns the reply parts; the registry only knows
   * when a phase starts. `tool` names the phase being narrated (the registry
   * tool name), so the persisted part can say *which* phase a line belongs to,
   * export and analytics separate an API-catalogue line from a search line
   * (#576).
   */
  narrate?: (text: string, tool: string) => void;
  emit: (event: RuntimeEvent) => void;
  signal?: AbortSignal;
}

/** One registry entry; `execute` returns the value handed back to the model. */
export interface RuntimeToolSpec {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
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
/** One message for every egress-policy block, "blocked" must be indistinguishable from "down". */
const EGRESS_BLOCKED_MESSAGE = "This host is not reachable from the assistant";

const searchMemoriesSpec: RuntimeToolSpec = {
  name: "searchMemories",
  description:
    "Search durable facts saved about this signed-in user from earlier conversations.",
  inputSchema: z.object({ query: z.string() }),
  label: () => "Searching long-term memory",
  summarize: (output) => {
    const count = (output as { memories?: unknown[] })?.memories?.length;
    return typeof count === "number" ? `${count} memories` : undefined;
  },
  async execute(input, ctx) {
    if (!ctx.searchMemories) return { memories: [] };
    const rows = await ctx.searchMemories(String(input.query ?? ""));
    return { memories: rows.map((row) => row.text) };
  },
};

/**
 * The Simplified-thinking narration field (#560), spliced onto every tool's input
 * schema while the toggle is on. It is an *argument* rather than a separate model
 * call because that makes the line free, and makes it structurally impossible for
 * the narration to describe a phase that did not run.
 */
const PROGRESS_FIELD = z
  .string()
  .optional()
  .describe(
    "One short sentence, in the user's own language, saying what you are about to do. It is shown to the user while this call runs, so write it for them, not for yourself."
  );

/**
 * Splits a tool call's arguments into the narration line and the arguments the
 * tool itself was defined with. Stripping matters: `progress` is display copy, and
 * a tool that forwards its arguments, `queryApi` puts them on the request,
 * would otherwise send the narration to the tenant's API as a parameter.
 */
function takeProgress(input: Record<string, unknown>): {
  progress: string | null;
  args: Record<string, unknown>;
} {
  const { progress, ...args } = input;
  const line = typeof progress === "string" ? progress.trim() : "";
  return { progress: line ? line.slice(0, PROGRESS_MAX_CHARS) : null, args };
}

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
 * live in the shared search-pass primitive (agentic-search/, #204), the
 * same code the deterministic seed loop runs, so seeded and model-driven
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
      "Search the assistant's knowledge base for facts relevant to the user's question. Pass several queries at once when a question has several parts; they run together and cost one iteration.",
    // Both shapes are accepted on purpose. Schema validation runs BEFORE
    // execute, so a model that sends the single-query form, a stale cached
    // prompt, or just a model that ignores the array, would otherwise spend a
    // whole iteration on a validation error instead of a search.
    inputSchema: z.object({
      queries: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          `What to search for, up to ${MAX_QUERIES_PER_SEARCH} distinct queries in one call`
        ),
      query: z
        .string()
        .optional()
        .describe("A single search query; prefer `queries`"),
      ...(ctx.narrate ? { progress: PROGRESS_FIELD } : {}),
    }),
    execute: async (
      input: { queries?: unknown; query?: unknown; progress?: unknown },
      options
    ) => {
      // One call is one iteration however many queries it batches; that is the
      // whole incentive for batching.
      ctx.loop?.spend();
      const { progress } = takeProgress(input as Record<string, unknown>);
      if (progress) ctx.narrate?.(progress, "searchKnowledge");
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
        iterationLimit: ctx.loop?.limit,
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
      // The batch fans out concurrently: the tool description promises the
      // queries "run together", and each is an independent embed + retrieve
      // round trip, so running them in series just stacked their latency.
      // The remaining budget is claimed synchronously up front (ledger length
      // + in-flight claims), so neither this batch nor a concurrent sibling
      // tool call can push the turn past the per-turn ceiling.
      const pending = (ctx.pendingSearchPasses ??= { count: 0 });
      const remaining = Math.max(
        0,
        budget - ctx.searchPasses.length - pending.count
      );
      const toRun = queries.slice(0, remaining);
      if (toRun.length < queries.length) exhausted = true;
      pending.count += toRun.length;
      let outcomes: Awaited<ReturnType<typeof runSearchPass>>[];
      try {
        outcomes = await Promise.all(
          toRun.map((query) =>
            runSearchPass(query, "collection", runtime, {
              onError: "report",
              emitLifecycle: false,
            })
          )
        );
      } finally {
        pending.count -= toRun.length;
      }
      for (const outcome of outcomes) {
        if (outcome.kind === "budget-exhausted") {
          exhausted = true;
          continue;
        }
        // A throwing searcher reads to the model like any broken tool, but one
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
      // so the model answers with what it has, never runs away with
      // cost/latency.
      if (exhausted && found.length === 0) {
        end(true, "No matching knowledge found");
        return withBudgetNote(
          {
            results: [],
            note: `Search budget reached (${budget} searches this turn). Do not search again, answer now with what you already found, and say honestly if it is not enough.`,
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
 * becomes an `{ error }` result for the model plus an `ok: false` tool-end,
 * one broken tool never aborts the turn.
 *
 * A spec that wants more than a one-line summary on the transcript (the API
 * card's endpoint/method/status/response) calls `ctx.recordResult`. The recorder
 * is bound to THIS call on a cloned context, because tools genuinely run
 * concurrently, the endpoint-detail tool is described as parallel-callable, and
 * one step's parallel calls cost one iteration by design, so a shared slot
 * would attribute one call's result to another.
 */
function instrument(spec: RuntimeToolSpec, ctx: ToolRuntimeContext): Tool {
  return tool({
    description: spec.description,
    inputSchema: ctx.narrate
      ? spec.inputSchema.extend({ progress: PROGRESS_FIELD })
      : spec.inputSchema,
    execute: async (rawInput: Record<string, unknown>, options) => {
      const callId = options?.toolCallId ?? `call-${++callSeq}`;
      const startedAt = Date.now();
      ctx.loop?.spend();
      // Narrate before the call, not after: the line says what is *about* to
      // happen, and the Visitor is watching it happen.
      const { progress, args: input } = takeProgress(rawInput);
      if (progress) ctx.narrate?.(progress, spec.name);
      ctx.emit({
        type: "tool-start",
        callId,
        tool: spec.name,
        label: spec.label(input),
        input,
        iteration: ctx.loop?.iteration,
        iterationLimit: ctx.loop?.limit,
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
    // Grounding tool: always on (not disableable, ADR-0002); wired straight
    // to the search-pass primitive rather than through `instrument`.
    searchKnowledge: searchKnowledgeTool(ctx),
  };
  if (ctx.searchMemories) {
    toolset[searchMemoriesSpec.name] = instrument(searchMemoriesSpec, ctx);
  }
  for (const spec of BUILT_IN_SPECS) {
    const enabled =
      overrides[spec.name as keyof typeof overrides] ??
      BUILT_IN_DEFAULTS[spec.name];
    if (enabled) toolset[spec.name] = instrument(spec, ctx);
  }
  // Windowed knowledge reads: available whenever the host wired a document
  // reader, integration or not, a long Source is a knowledge concern.
  if (ctx.readKnowledgeDocument) {
    toolset[READ_KNOWLEDGE_SOURCE_SPEC.name] = instrument(
      READ_KNOWLEDGE_SOURCE_SPEC,
      ctx
    );
  }
  // The API catalogue triad + its response reader (spec #559). Registered only
  // with a described catalogue behind them: an assistant with no integration
  // must not be told an API exists. This is the ONLY way an org reaches its own
  // HTTP API from a turn: the per-endpoint custom tools it replaced are gone.
  const integrationNeedsIdentity = ctx.apiIntegration?.endpoints.some((endpoint) =>
    endpoint.params?.some((param) =>
      param.value?.includes("{{identity.")
    )
  );
  const verifiedSso = ctx.toolSubject?.type === "sso" && Boolean(ctx.toolSubject.subjectId);
  if (
    ctx.apiIntegration &&
    ctx.apiIntegration.endpoints.length > 0 &&
    (!integrationNeedsIdentity || verifiedSso)
  ) {
    for (const spec of API_CATALOG_SPECS) {
      toolset[spec.name] = instrument(spec, ctx);
    }
  }
  if (ctx.queryEntityRecords) {
    const subject = ctx.toolSubject;
    // Record-grounded answers cite like knowledge- and API-grounded ones: an
    // answered Entity query lands its stable citation in the collector.
    const cite = (source: KnowledgeSearchResult) => ctx.usedSources.push(source);
    for (const entity of ctx.entities ?? []) {
      const specs: RuntimeToolSpec[] =
        entity.scope === "shared"
          ? entityToolSpecs(entity, ctx.queryEntityRecords, null, { cite })
          : subject?.type === "sso" && subject.claimValue
            ? entityToolSpecs(
                entity,
                ctx.queryEntityRecords,
                { value: subject.claimValue },
                { cite }
              )
            : subject?.type === "member"
              ? entityToolSpecs(entity, ctx.queryEntityRecords, null, {
                  crossRecord: true,
                  cite,
                })
              : [];
      for (const spec of specs) {
        const suffix = entity.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
        const name = toolset[spec.name] ? `${spec.name}_${suffix}` : spec.name;
        if (!toolset[name]) toolset[name] = instrument({ ...spec, name }, ctx);
      }
    }
  }
  // The terminal tool: mandatory when a turn has a terminal declaration to
  // make. Not instrumented: declaring you are done spends no iteration, and its
  // result is the write-time instruction the model then acts on. It emits the
  // tool lifecycle itself (#574), so the declaration is visible to every Role
  // that can read the Inbox, not just those above the reasoning gate.
  if (ctx.terminal) {
    toolset.readyToAnswer = readyToAnswerTool(
      ctx.terminal,
      ctx.writeTimeStyle ?? {},
      ctx.emit
    );
  }
  return toolset;
}
