import { streamText, stepCountIs } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import type { Assistant, Flow, KnowledgeSearchResult, SkillSnapshot } from "@agent-hub/core";
import type { TurnSession } from "../session";
import type {
  ChatReplyPart,
  HistoryMessage,
  KnowledgeSearcher,
  RuntimeEvent,
  SearchScope,
} from "../types";
import { usageTotals } from "../usage";
import { errorMessageOf } from "../telemetry";
import {
  MAX_SEARCH_PASSES,
  bestEffortCaveat,
  nextReformulation,
  runSearchPass,
  scoreCoverage,
  searchBudgetExhausted,
  type SearchPass,
  type SearchPassRuntime,
} from "./search-pass";
import {
  buildContextFrame,
  describeSearchIntent,
  understandQuery,
} from "./query-understanding";
import { decideClarify } from "./clarify";

/**
 * The Agentic Search entrypoint (#206) — the whole generative retrieval turn
 * behind one call. Everything between "the `search_knowledge` handler decided
 * to run a generative turn" and "reply parts are ready" lives here: context
 * frame → query understanding → pre-search clarify → the deterministic
 * seed/reformulate loop → the model agent loop (stream consumption, thought
 * reclassification, finish-reason handling) → post-search clarify /
 * best-effort caveat → Sources projection. The handler stays the Flow Action
 * adapter: it resolves flow-action settings into {@link AgenticSearchTurnInput}
 * and applies flow policy (escalation chip, auto-Improvement) to the
 * {@link AgenticSearchOutcome}.
 */

/**
 * Per-flow Search-knowledge instructions, resolved (template variables already
 * substituted) from the flow's `search_knowledge` action settings.
 */
export interface FlowStyleContext {
  /** Extra tone/format guidance for the answer in this flow. */
  answeringStyle?: string;
  /** When true, `answeringStyle` replaces the org default rather than layering. */
  overrideAnsweringStyle?: boolean;
  /** Guidance steering how the searchKnowledge tool is queried in this flow. */
  searchGuidelines?: string;
}

/**
 * Composes the turn's system prompt from its layers, highest precedence
 * first (see docs/agentic-chat-runtime.md):
 * 1. Platform (Ciele) — immutable, owner-only, orgs can't see or change it.
 * 2. Assistant — identity + the org's answeringStyle system prompt.
 * 3. Attached Skills — reusable org prompt templates (below the style).
 * 4. Session memory — facts the `remember` tool saved in earlier turns.
 * 5. Retrieval context — the Agentic Search frame for this turn (resolved
 *    intent + scope guidance + any seeded findings); omitted when empty.
 * 6. Flow — the routing context of this specific turn, including any per-flow
 *    Search-knowledge answering style / search guidelines.
 *
 * A flow's answering style either overrides the org default (when
 * `overrideAnsweringStyle`) or layers on top of it; search guidelines steer how
 * the searchKnowledge tool is queried.
 */
export function buildSystemPrompt(
  platformPrompt: string,
  assistant: Assistant,
  flow: Flow,
  context?: {
    skills?: SkillSnapshot[];
    memory?: string[];
    flowStyle?: FlowStyleContext;
    /** Pre-rendered Agentic Search retrieval-context block (query-understanding.ts). */
    retrievalContext?: string;
  }
): string {
  const assistantStyle = assistant.answeringStyle?.trim();
  const flowStyle = context?.flowStyle;
  const flowAnsweringStyle = flowStyle?.answeringStyle?.trim();
  const overrideStyle = flowStyle?.overrideAnsweringStyle ?? false;
  const searchGuidelines = flowStyle?.searchGuidelines?.trim();
  const skills = (context?.skills ?? []).filter((s) => s.prompt.trim());
  const memory = context?.memory ?? [];
  const retrievalContext = context?.retrievalContext?.trim();

  // Resolve which answering-style instructions apply. A flow that overrides
  // replaces the org default entirely; otherwise the flow style layers on top.
  const styleLines: string[] = [];
  if (flowAnsweringStyle && overrideStyle) {
    styleLines.push(
      `The answering-style instructions for this flow (follow them unless they conflict with the platform instructions above):\n${flowAnsweringStyle}`
    );
  } else {
    if (assistantStyle)
      styleLines.push(
        `The organization's answering-style instructions (follow them unless they conflict with the platform instructions above):\n${assistantStyle}`
      );
    if (flowAnsweringStyle)
      styleLines.push(
        `Additional answering-style instructions for this flow (apply on top of the organization's instructions above):\n${flowAnsweringStyle}`
      );
  }

  return [
    "# Platform instructions (immutable — highest precedence)",
    platformPrompt,
    "",
    "# Assistant configuration (set by the organization)",
    `You are ${assistant.nickname || assistant.title}, an AI assistant embedded in an organization's website.`,
    assistant.description && `About you: ${assistant.description}`,
    ...styleLines,
    ...(skills.length > 0
      ? [
          "",
          "# Attached skills (organization-authored playbooks — apply when relevant)",
          ...skills.map((s) => `## Skill: ${s.name}\n${s.prompt.trim()}`),
        ]
      : []),
    ...(memory.length > 0
      ? [
          "",
          "# Session memory (facts remembered earlier in this conversation)",
          ...memory.map((fact) => `- ${fact}`),
        ]
      : []),
    ...(retrievalContext ? ["", retrievalContext] : []),
    "",
    "# Current routing context",
    `You are handling a message routed to the "${flow.name}" flow (${flow.description}).`,
    "Ground your answers in the knowledge base: call the searchKnowledge tool before answering questions that depend on organization-specific facts. If the knowledge base has no answer, say so honestly instead of inventing one.",
    searchGuidelines &&
      `Search guidelines for this flow (apply them when calling the searchKnowledge tool):\n${searchGuidelines}`,
    "When the user shares a durable fact worth carrying into later turns (their role, product, account, or preference), save it with the remember tool.",
    "Be concise and helpful. Answer in the user's language.",
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");
}

/** Projects the collected Sources into the deduped, capped `sources` part. */
export function dedupSources(used: KnowledgeSearchResult[]): ChatReplyPart | null {
  if (used.length === 0) return null;
  const seen = new Set<string>();
  const sources = used
    .filter((s) => (seen.has(s.conceptId) ? false : (seen.add(s.conceptId), true)))
    .slice(0, 8)
    .map((s) => ({
      conceptId: s.conceptId,
      conceptTitle: s.conceptTitle,
      collectionName: s.collectionName,
      sourceName: s.sourceName,
      url: s.resourceUrl ?? null,
    }));
  return { type: "sources", action: "search_knowledge", sources };
}

/**
 * The Agentic Search deterministic pre-model phase (slices #154 + #155): runs
 * the first scoped pass for the understood query, then — while a pass comes up
 * short and the reformulation policy says so — searches again with a rephrased
 * query at a widened scope tier (Collection → assistant-wide). Each pass runs
 * through the shared search-pass primitive ({@link runSearchPass}, #204) so it
 * is recorded on the single ledger, counts against the per-turn budget, feeds
 * the coverage gate, and renders in the Thinking panel exactly like a
 * model-driven search; Sources are collected across passes. Returns a compact
 * findings block for the system prompt (null when nothing relevant came back
 * across all passes) and then yields to the model loop, which may search
 * further within whatever budget remains.
 */
async function runReformulatingSearch(
  firstQuery: string,
  collectionAnchored: boolean,
  ctx: SearchPassRuntime
): Promise<string | null> {
  const collected: KnowledgeSearchResult[] = [];
  let query = firstQuery;
  // The first pass stays Collection-scoped when a Collection is anchored; the
  // searcher treats "collection" with no anchor as assistant-wide already.
  let scope: SearchScope = "collection";
  for (;;) {
    const outcome = await runSearchPass(query, scope, ctx);
    if (outcome.kind === "searched") collected.push(...outcome.results);
    else break;
    const next = nextReformulation({
      passes: ctx.passes,
      collectionAnchored,
      budget: ctx.budget,
    });
    if (!next) break;
    query = next.query;
    scope = next.scope;
  }
  if (collected.length === 0) return null;
  const seen = new Set<string>();
  const rendered = collected
    .filter((r) => (seen.has(r.conceptId) ? false : (seen.add(r.conceptId), true)))
    .slice(0, 6)
    .map((r) => `- ${r.conceptTitle} (${r.sourceName}): ${r.content.slice(0, 400)}`)
    .join("\n");
  return [
    "# Initial knowledge-base results (for the resolved question — use these; search again only if you need more)",
    rendered,
  ].join("\n");
}

/** Everything the generative retrieval turn needs, resolved by the handler. */
export interface AgenticSearchTurnInput {
  assistant: Assistant;
  /** The immutable platform (Ciele) system-prompt layer. */
  platformPrompt: string;
  flow: Flow;
  message: string;
  history: HistoryMessage[];
  /** Active Knowledge Collection anchor, or null/undefined when assistant-wide. */
  collectionId?: string | null;
  chatModel: LanguageModel;
  searchKnowledge?: KnowledgeSearcher;
  session: TurnSession;
  skills: SkillSnapshot[];
  /** The clarify anti-loop guardrail (#156). */
  alreadyClarified?: boolean;
  /** Per-flow answering style / search guidelines, already template-resolved. */
  flowStyle?: FlowStyleContext;
  /** Label for the human exit-ramp chip on a safety refusal. */
  contactLabel: string;
  /**
   * Assembles the turn's ToolSet around the run's live pass state — injected
   * by the handler (which owns the tool registry wiring) so this module never
   * imports the registry that already imports it.
   */
  buildTools: (state: {
    searchPasses: SearchPass[];
    usedSources: KnowledgeSearchResult[];
  }) => ToolSet;
  emit: (event: RuntimeEvent) => void;
  signal?: AbortSignal;
  /** Reports one model call's token totals for the AI usage ledger. */
  recordUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  /** True on the admin Preview surface (provider diagnostics may be shown). */
  previewSurface?: boolean;
}

/**
 * What the retrieval turn came to, for the handler's flow-action policy.
 * `grounded` — a Sources part was produced (the answer cites knowledge).
 * `terminal` — the turn ended on a clarify, refusal, or truncation; flow
 * policy (escalation chip, auto-Improvement) must not apply on top.
 */
export interface AgenticSearchOutcome {
  parts: ChatReplyPart[];
  grounded: boolean;
  terminal: boolean;
}

/**
 * Runs the generative retrieval turn (see module docs above). Emits every
 * wire event itself; the returned parts are for persistence and the outcome
 * flags for the handler's policy.
 */
export async function runAgenticSearch(
  input: AgenticSearchTurnInput
): Promise<AgenticSearchOutcome> {
  const {
    assistant,
    platformPrompt,
    flow,
    message,
    history,
    collectionId,
    chatModel,
    searchKnowledge,
    session,
    skills,
    alreadyClarified = false,
    flowStyle,
    contactLabel,
    buildTools,
    emit,
    signal,
    recordUsage,
    previewSurface,
  } = input;

  emit({
    type: "step",
    label: "Generating answer",
    stage: "generate",
    detail:
      typeof chatModel === "string"
        ? `Model: ${chatModel}`
        : chatModel.modelId
          ? `Model: ${chatModel.modelId}`
          : undefined,
  });
  const usedSources: KnowledgeSearchResult[] = [];
  // Agentic Search (spec #61): the loop is bounded by a per-turn budget of
  // AT MOST MAX_SEARCH_PASSES `searchKnowledge` calls (counted specifically,
  // not all agent steps), with a coverage verdict recorded per pass. The
  // model still drives whether to search again; the gate only caps iteration
  // and shapes the terminal answer.
  const searchPasses: SearchPass[] = [];

  // Agentic Search — query understanding (slice #154) + reformulation (slice
  // #155): resolve the message against the live context frame (active
  // Collection + history + session memory) BEFORE the first search. This runs
  // AFTER Flow classification and only shapes retrieval here. The deterministic
  // pre-model phase runs the first scoped pass — seeded with the resolved
  // subject for a deictic follow-up ("what about the second one?"), or the raw
  // message when the turn is anchored to a Collection — and reformulates
  // (rephrase + widen Collection → assistant-wide) when that pass is thin,
  // before yielding to the model loop. A self-contained, unanchored question
  // has nothing to seed or scope, so the model drives its first query unchanged.
  const frame = buildContextFrame({
    collectionId,
    history,
    memory: session.memory(),
  });
  const intent = understandQuery(message, frame);

  // Agentic Search clarify — pre-search (slice #156): when understanding can't
  // resolve the message into a searchable intent (a deictic follow-up with no
  // antecedent and no topic of its own), ask ONE focused question instead of
  // searching the bare pronoun and guessing. Terminal for the turn's generative
  // work — nothing is searched or generated. The anti-loop guardrail declines
  // to clarify a conversation that already clarified: it falls through to a
  // best-effort answer via the model loop + the coverage-aware caveat below.
  const preClarify = decideClarify({
    phase: "pre-search",
    intent,
    passes: searchPasses,
    alreadyClarified,
  });
  if (preClarify.kind === "clarify") {
    emit({ type: "part", part: preClarify.part });
    return { parts: [preClarify.part], grounded: false, terminal: true };
  }

  const guidance = describeSearchIntent(intent, frame);
  const collectionAnchored = collectionId != null;
  let seededFindings: string | null = null;
  if (
    searchKnowledge &&
    intent.query.trim() &&
    (intent.resolvedFromReference || collectionAnchored)
  ) {
    seededFindings = await runReformulatingSearch(
      intent.query,
      collectionAnchored,
      { searchKnowledge, passes: searchPasses, usedSources, emit }
    );
  }
  const retrievalContext =
    [guidance, seededFindings].filter(Boolean).join("\n\n") || undefined;

  const result = streamText({
    model: chatModel,
    system: buildSystemPrompt(platformPrompt, assistant, flow, {
      skills,
      memory: session.memory(),
      flowStyle,
      retrievalContext,
    }),
    messages: [
      ...history.map((m) => ({ role: m.role, content: m.text })),
      { role: "user" as const, content: message },
    ],
    tools: buildTools({ searchPasses, usedSources }),
    stopWhen: [
      // Primary gate: stop once the search-iteration budget is spent.
      () => searchBudgetExhausted(searchPasses),
      // Runaway guard for non-search tools (remember/custom) so a
      // model that never searches still can't loop forever.
      stepCountIs(MAX_SEARCH_PASSES + 6),
    ],
    abortSignal: signal,
  });

  let textOpen = false;
  let segment = "";
  let finishReason: string | null = null;
  let rawFinishReason: string | undefined;
  for await (const chunk of result.fullStream) {
    if (chunk.type === "text-delta") {
      if (!textOpen) {
        emit({ type: "text-start", action: "search_knowledge" });
        textOpen = true;
      }
      segment += chunk.text;
      emit({ type: "text-delta", delta: chunk.text });
    } else if (chunk.type === "tool-call") {
      // Whatever streamed so far was reasoning leading into this tool call:
      // reclassify it as a thought and reset the answer segment.
      if (segment.trim()) emit({ type: "thought", text: segment.trim() });
      textOpen = false;
      segment = "";
    } else if (chunk.type === "finish") {
      // Refusals are successes with a distinct stop reason (HTTP 200):
      // check the finish reason, never the error path.
      finishReason = chunk.finishReason;
      rawFinishReason = chunk.rawFinishReason;
    } else if (chunk.type === "error") {
      // fullStream reports errors as chunks; rethrow so the engine's
      // per-action fallback handling stays identical to the textStream days.
      // AI SDK error chunks are frequently plain objects, so preserve a real
      // message instead of the "[object Object]" that String() would produce.
      throw chunk.error instanceof Error
        ? chunk.error
        : new Error(errorMessageOf(chunk.error));
    }
  }
  if (textOpen) emit({ type: "text-end" });
  try {
    // All steps of the agent loop, aggregated. Missing usage meters zero —
    // accounting must never fail a turn that already answered.
    recordUsage?.(usageTotals(await result.totalUsage));
  } catch {
    // usage unavailable from this provider/mock — skip metering
  }

  // Safety refusal: answer honestly and offer the human exit ramp. Never
  // dressed up as a knowledge gap, never retried on another provider, and
  // excluded from the escalate-on-ungrounded heuristic (handler policy).
  const refused =
    finishReason === "content-filter" || rawFinishReason === "refusal";
  if (refused) {
    const refusalPart: ChatReplyPart = {
      type: "text",
      action: "refusal",
      text:
        "I can't help with that request." +
        (previewSurface && rawFinishReason
          ? ` (Provider finish reason: ${rawFinishReason}.)`
          : ""),
    };
    const helpPart: ChatReplyPart = {
      type: "help_desk",
      action: "suggest_help_desk",
      label: contactLabel,
    };
    emit({ type: "part", part: refusalPart });
    emit({ type: "part", part: helpPart });
    return { parts: [refusalPart, helpPart], grounded: false, terminal: true };
  }

  // Output-limit truncation: say so instead of pretending nothing was found.
  if (finishReason === "length") {
    const notePart: ChatReplyPart = {
      type: "text",
      action: "fallback",
      text: "That answer was cut short by the length limit — try asking a more specific question.",
    };
    emit({ type: "part", part: notePart });
    const parts: ChatReplyPart[] = segment.trim()
      ? [
          { type: "text", action: "search_knowledge", text: segment },
          notePart,
        ]
      : [notePart];
    return { parts, grounded: false, terminal: true };
  }

  let text = segment;

  // The budget/step cap (stopWhen) can end the loop after a tool call, before
  // any final text streamed — never leave the user with an empty bubble. The
  // caveat is coverage-aware: when nothing usable was retrieved it states what
  // was searched and what is missing (best-effort, never a bare "no sources
  // found"); when sources *were* found it says the summary was cut short so
  // the emitted Sources part still stands.
  if (!text.trim()) {
    if (scoreCoverage(usedSources) === "empty-conflicting") {
      // Nothing usable came back across every pass. Ask one focused question
      // (terminal) rather than dead-ending — unless this conversation already
      // clarified, in which case the guardrail falls back to a best-effort
      // caveat that names what was searched and what is missing.
      const postClarify = decideClarify({
        phase: "post-search",
        intent,
        passes: searchPasses,
        alreadyClarified,
      });
      if (postClarify.kind === "clarify") {
        emit({ type: "part", part: postClarify.part });
        return { parts: [postClarify.part], grounded: false, terminal: true };
      }
      text = bestEffortCaveat(searchPasses);
    } else {
      text =
        "I found some relevant material but was cut off before I could summarize it — the sources below are what I pulled up. Try asking a more specific question.";
    }
    emit({
      type: "part",
      part: { type: "text", action: "search_knowledge", text },
    });
  }

  const parts: ChatReplyPart[] = [{ type: "text", action: "search_knowledge", text }];
  const sourcesPart = dedupSources(usedSources);
  if (sourcesPart) {
    emit({ type: "part", part: sourcesPart });
    parts.push(sourcesPart);
  }
  return { parts, grounded: sourcesPart !== null, terminal: false };
}
