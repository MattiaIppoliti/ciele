import { streamText, stepCountIs } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import type { Assistant, Flow, KnowledgeSearchResult, SkillSnapshot } from "@agent-hub/core";
import { PROGRESS_MAX_CHARS } from "@agent-hub/core";
import type { TurnSession } from "../session";
import type {
  ChatReplyPart,
  HistoryMessage,
  KnowledgeSearcher,
  RuntimeEvent,
} from "../types";
import { usageTotals } from "../usage";
import { errorMessageOf } from "../telemetry";
import { searchBudgetExhausted, type SearchPass } from "./search-pass";
import { buildContextFrame, describeContextFrame } from "./query-understanding";
import {
  MAX_AGENT_ITERATIONS,
  createLoopBudget,
  type LoopBudget,
} from "./loop-budget";
import {
  createTerminalState,
  resolveTerminalStatus,
  type TerminalState,
  type WriteTimeStyle,
} from "./ready-to-answer";

/**
 * The Agentic Search entrypoint (#206): the whole generative retrieval turn
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
 * 1. Platform (Ciele): immutable, owner-only, orgs can't see or change it.
 * 2. Assistant: identity + the org's answeringStyle system prompt.
 * 3. Attached Skills: reusable org prompt templates (below the style).
 * 4. Session memory: facts the `remember` tool saved in earlier turns.
 * 5. Retrieval context: the Agentic Search frame for this turn (resolved
 *    intent + scope guidance + any seeded findings); omitted when empty.
 * 6. Flow: the routing context of this specific turn, including any per-flow
 *    Search-knowledge answering style / search guidelines.
 *
 * A flow's answering style either overrides the org default (when
 * `overrideAnsweringStyle`) or layers on top of it; search guidelines steer how
 * the searchKnowledge tool is queried.
 */
/**
 * Resolves the answering-style instructions that apply to this turn. A flow that
 * overrides replaces the org default entirely; otherwise the flow style layers
 * on top. Returned rather than inlined because the style is **late-bound**: it
 * reaches the model on the terminal tool's result at the moment of writing, not
 * in the gather-phase prompt where it would compete with tool selection (#558).
 */
export function resolveAnsweringStyle(
  assistant: Assistant,
  flowStyle?: FlowStyleContext
): string | undefined {
  const assistantStyle = assistant.answeringStyle?.trim();
  const flowAnsweringStyle = flowStyle?.answeringStyle?.trim();
  const overrideStyle = flowStyle?.overrideAnsweringStyle ?? false;
  const lines: string[] = [];
  if (flowAnsweringStyle && overrideStyle) {
    lines.push(flowAnsweringStyle);
  } else {
    if (assistantStyle) lines.push(assistantStyle);
    if (flowAnsweringStyle)
      lines.push(
        `Additional instructions for this flow (apply on top of the above):\n${flowAnsweringStyle}`
      );
  }
  return lines.length > 0 ? lines.join("\n\n") : undefined;
}

export function buildSystemPrompt(
  platformPrompt: string,
  assistant: Assistant,
  flow: Flow,
  context?: {
    skills?: SkillSnapshot[];
    memory?: string[];
    longTermMemory?: string[];
    flowStyle?: FlowStyleContext;
    /** Pre-rendered context frame for this turn (query-understanding.ts). */
    retrievalContext?: string;
    /**
     * Which half of the two-phase turn this prompt is for (#558).
     * - `gather` (default): tools are available and the model may NOT write to
     *   the user; it must finish by calling the terminal tool.
     * - `write`: no tools; the answering style applies and the model writes.
     */
    phase?: "gather" | "write";
    /**
     * An earlier turn in this conversation already asked the Visitor to clarify.
     * Told to the model so it does not ask again; the terminal tool enforces it.
     */
    alreadyClarified?: boolean;
  }
): string {
  const flowStyle = context?.flowStyle;
  const searchGuidelines = flowStyle?.searchGuidelines?.trim();
  const skills = (context?.skills ?? []).filter((s) => s.prompt.trim());
  const memory = context?.memory ?? [];
  const longTermMemory = context?.longTermMemory ?? [];
  const retrievalContext = context?.retrievalContext?.trim();
  const phase = context?.phase ?? "gather";
  const answeringStyle = resolveAnsweringStyle(assistant, flowStyle);

  return [
    "# Platform instructions (immutable, highest precedence)",
    platformPrompt,
    "",
    "# Assistant configuration (set by the organization)",
    `You are ${assistant.nickname || assistant.title}, an AI assistant embedded in an organization's website.`,
    assistant.description && `About you: ${assistant.description}`,
    // The style rides the terminal tool's result in the gather phase, so it is
    // stated here only when the model is actually writing.
    phase === "write" && answeringStyle
      ? `The organization's answering-style instructions (follow them unless they conflict with the platform instructions above):\n${answeringStyle}`
      : undefined,
    ...(skills.length > 0
      ? [
          "",
          "# Attached skills (organization-authored playbooks, apply when relevant)",
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
    ...(longTermMemory.length > 0
      ? [
          "",
          "# Long-term memory (facts remembered from this user's past conversations)",
          ...longTermMemory.map((fact) => `- ${fact}`),
        ]
      : []),
    ...(retrievalContext ? ["", retrievalContext] : []),
    "",
    "# Current routing context",
    `You are handling a message routed to the "${flow.name}" flow (${flow.description}).`,
    ...(phase === "gather"
      ? [
          "",
          "# This turn has two phases and you are in the FIRST one",
          "Gather what you need, then declare you are done. Do NOT write anything addressed to the user in this phase, no answer, no apology, no clarification question. Any prose you produce here is treated as your private reasoning.",
          // Streamed thinking (#584): the reasoning is watched live in the
          // Thinking panel, so the model narrates every step of the loop in
          // the Visitor's language, the reference's [Thinking:] cadence.
          "Think out loud as you go; this is REQUIRED, not optional: NEVER emit a tool call without first writing one or two short sentences of reasoning in the user's own language, saying what you have learned so far and what you will do next. That includes your FIRST tool call and the final readyToAnswer call. The user watches this reasoning stream in a side panel while they wait, so keep it presentable; it is still reasoning, not the answer.",
          "Ground yourself in the knowledge base: call searchKnowledge before answering anything that depends on organization-specific facts. Pass several queries in one call when the question has several parts, one call costs one iteration however many queries it carries.",
          "If a search comes back thin, search again with different wording; you do not need permission to reformulate.",
          "The knowledge base is often written in a different language than the user's message. When the user writes in another language, include translated variants (English plus the organization's likely language) among the queries of the SAME call, retrieval matches the document's own words, so a query in the wrong language finds nothing even when the answer is there.",
          "You MUST finish by calling readyToAnswer exactly once, with the status that matches what you found. You will then get a second phase in which to write, and its instructions arrive on that tool's result.",
          context?.alreadyClarified
            ? "This conversation has ALREADY asked the visitor to clarify once. Do not ask again, answer as best you can from what you find and say plainly what you could not determine."
            : undefined,
          searchGuidelines &&
            `Search guidelines for this flow (apply them when calling searchKnowledge):\n${searchGuidelines}`,
          // Simplified thinking (#560): the narration rides the tool call it
          // describes, so it costs nothing and can never describe a phase that
          // did not run. The schema field only exists while the toggle is on.
          assistant.simplifiedThinking
            ? `Every tool call MUST also set \`progress\`: one short sentence, in the user's own language, telling them what you are about to do, e.g. "Sto cercando i video nella sezione Video Prova del corso…". The user reads it while the call runs, so write it for them, keep it under ${PROGRESS_MAX_CHARS} characters, and never put reasoning, tool names or internal detail in it.`
            : undefined,
          "When the user shares a durable fact worth carrying into later turns (their role, product, account, or preference), save it with the remember tool.",
        ]
      : [
          "",
          "# You are in the SECOND phase: write the reply",
          "You have no tools now. Write from what you gathered above, following the instructions on the readyToAnswer result. Never invent what the knowledge base did not give you.",
          "Be concise and helpful. Answer in the user's language.",
        ]),
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");
}

/** Projects the collected Sources into the deduped, capped `sources` part. */
export function dedupSources(used: KnowledgeSearchResult[]): ChatReplyPart | null {
  if (used.length === 0) return null;
  const seen = new Set<string>();
  // Keyed on the Concept when there is one, falling back to source name + URL:
  // a citation that does not come from a Concept (a live API result, #559) has no
  // conceptId to dedupe on, and keying on a missing id would collapse every one
  // of them into a single chip.
  const keyOf = (s: KnowledgeSearchResult) =>
    s.conceptId || `${s.sourceName ?? ""}|${s.resourceUrl ?? ""}`;
  const sources = used
    .filter((s) => (seen.has(keyOf(s)) ? false : (seen.add(keyOf(s)), true)))
    .slice(0, 8)
    .map((s) => ({
      conceptId: s.conceptId,
      conceptTitle: s.conceptTitle,
      collectionName: s.collectionName,
      sourceName: s.sourceName,
      url: s.resourceUrl ?? null,
      sourceId: s.sourceId ?? null,
      directAccess: s.directAccess === true,
    }));
  return { type: "sources", action: "search_knowledge", sources };
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
  /** Durable facts recalled for this SSO subject from earlier conversations. */
  longTermMemory?: string[];
  /**
   * Whether an earlier turn in THIS conversation already asked the Visitor to
   * clarify (derived from the persisted parts upstream). The anti-loop
   * guarantee: never a second clarification in the same conversation.
   */
  alreadyClarified?: boolean;
  /** Per-flow answering style / search guidelines, already template-resolved. */
  flowStyle?: FlowStyleContext;
  /** Label for the human exit-ramp chip on a safety refusal. */
  contactLabel: string;
  /**
   * Assembles the turn's ToolSet around the run's live pass state, injected
   * by the handler (which owns the tool registry wiring) so this module never
   * imports the registry that already imports it.
   */
  buildTools: (state: {
    searchPasses: SearchPass[];
    usedSources: KnowledgeSearchResult[];
    /** The turn's iteration budget, so every tool result carries its note (#558). */
    loop: LoopBudget;
    /** The terminal declaration the gather phase must end with (#558). */
    terminal: TerminalState;
    /** Answering style, late-bound onto the terminal tool's result (#558). */
    writeTimeStyle: WriteTimeStyle;
    /**
     * Simplified-thinking sink (#560), or undefined when the toggle is off. The
     * registry calls it as each tool phase starts, naming the tool being
     * narrated (#576), and the turn turns the line into a streamed and
     * persisted `progress` part.
     */
    narrate: ((text: string, tool: string) => void) | undefined;
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
 * `grounded`: a Sources part was produced (the answer cites knowledge).
 * `terminal`: the turn ended on a clarify, refusal, or truncation; flow
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
    session,
    skills,
    longTermMemory = [],
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
    type: "notice",
    label: "Generating answer",
    detail:
      typeof chatModel === "string"
        ? `Model: ${chatModel}`
        : chatModel.modelId
          ? `Model: ${chatModel.modelId}`
          : undefined,
  });
  const usedSources: KnowledgeSearchResult[] = [];
  // At most MAX_SEARCH_PASSES `searchKnowledge` passes per turn, counted
  // specifically rather than as agent steps, with a coverage verdict recorded
  // per pass for the transcript. The model drives whether to search again.
  const searchPasses: SearchPass[] = [];
  // The iteration budget the model is TOLD about (loop-budget.ts) and the
  // terminal declaration it must make (ready-to-answer.ts).
  const loop = createLoopBudget(MAX_AGENT_ITERATIONS);
  const terminal = createTerminalState();
  // Late-bound: the style reaches the model on the terminal tool's result, at
  // the moment of writing, not in the gather prompt where it would compete with
  // tool selection for the whole loop.
  const answeringStyle = resolveAnsweringStyle(assistant, flowStyle);

  // The live signals retrieval may use, stated for the model rather than
  // resolved for it: the anchored Knowledge Collection. Deictic follow-ups
  // ("what about the second one?") are the model's job now; it has the
  // history, and its own reasoning resolves them (#558). Remembered facts are
  // NOT part of the frame: the system prompt's two memory blocks (session /
  // long-term, below) are their single owner, rendering them here too used to
  // put every fact in the gather prompt twice and erase the session-vs-durable
  // distinction the two blocks exist to preserve.
  const frame = buildContextFrame({
    collectionId,
    history,
  });
  const retrievalContext = describeContextFrame(frame);

  // Simplified thinking (#560): the narration lines the tool phases produce.
  // Streamed the moment each phase starts, and returned with the reply so the
  // saved message, and the Inbox transcript, carry the same narration the
  // Visitor watched. Their own parts, never concatenated onto the answer text.
  const progressParts: ChatReplyPart[] = [];
  const narrate = assistant.simplifiedThinking
    ? (text: string, tool: string) => {
        const part: ChatReplyPart = {
          type: "progress",
          // The knowledge search keeps its flow-action name (also the value
          // every part persisted before #576 carries); other phases carry the
          // registry tool name, so export/analytics can tell an API-catalogue
          // line from a search line.
          action: tool === "searchKnowledge" ? "search_knowledge" : tool,
          text,
        };
        progressParts.push(part);
        emit({ type: "part", part });
      }
    : undefined;

  const tools = buildTools({
    searchPasses,
    usedSources,
    loop,
    terminal,
    writeTimeStyle: { answeringStyle, alreadyClarified },
    narrate,
  });

  // ── Phase 1: gather ────────────────────────────────────────────────────────
  // Tools are available and the model may not address the user. Everything it
  // writes here is private reasoning, which is what makes "no answer text
  // without a terminal declaration" structural rather than a hope.
  const gather = streamText({
    model: chatModel,
    system: buildSystemPrompt(platformPrompt, assistant, flow, {
      skills,
      memory: session.memory(),
      longTermMemory,
      flowStyle,
      retrievalContext,
      phase: "gather",
      alreadyClarified,
    }),
    messages: [
      ...history.map((m) => ({ role: m.role, content: m.text })),
      { role: "user" as const, content: message },
    ],
    tools,
    stopWhen: [
      // The declaration ends the phase: there is nothing left to gather for.
      () => terminal.status !== null,
      // The binding gate: the budget the model has been planning against, and
      // the number it was told. Declaring is free, so a model that spends every
      // iteration searching can still finish by declaring.
      () => loop.iteration >= loop.limit,
      // Retrieval cost ceiling underneath it, only a pathological batch hits it.
      () => searchBudgetExhausted(searchPasses),
      // Runaway guard: a model that neither searches nor declares still cannot
      // loop forever.
      stepCountIs(MAX_AGENT_ITERATIONS + 2),
    ],
    // An iteration is a STEP, not a tool call: the step's parallel calls have
    // all run by now and between them spent exactly one (see loop-budget.ts).
    onStepFinish: () => loop.endStep(),
    abortSignal: signal,
  });

  let reasoning = "";
  // Chars of `reasoning` already streamed as thought-deltas (#584). Deltas are
  // withheld while the accumulation is pure whitespace, so a model that emits
  // a stray newline never opens an empty thought in the panel.
  let streamed = 0;
  let finishReason: string | null = null;
  let rawFinishReason: string | undefined;
  const flushReasoning = () => {
    if (reasoning.trim()) emit({ type: "thought", text: reasoning.trim() });
    reasoning = "";
    streamed = 0;
  };
  for await (const chunk of gather.fullStream) {
    if (chunk.type === "text-delta") {
      reasoning += chunk.text;
      // Stream the reasoning as it is written, the Visitor watches it build
      // in the Thinking panel; the terminal `thought` on the next tool call
      // stays the authoritative whole.
      if (reasoning.trim()) {
        const delta =
          streamed === 0 ? reasoning.trimStart() : reasoning.slice(streamed);
        if (delta) emit({ type: "thought-delta", delta });
        streamed = reasoning.length;
      }
    } else if (chunk.type === "tool-call") {
      flushReasoning();
    } else if (chunk.type === "finish") {
      // Refusals are successes with a distinct stop reason (HTTP 200):
      // check the finish reason, never the error path.
      finishReason = chunk.finishReason;
      rawFinishReason = chunk.rawFinishReason;
    } else if (chunk.type === "error") {
      throw chunk.error instanceof Error
        ? chunk.error
        : new Error(errorMessageOf(chunk.error));
    }
  }
  flushReasoning();
  try {
    recordUsage?.(usageTotals(await gather.totalUsage));
  } catch {
    // usage unavailable from this provider/mock, accounting must never fail a
    // turn that already did its work
  }

  // Safety refusal: answer honestly and offer the human exit ramp. Never
  // dressed up as a knowledge gap, never retried on another provider, and
  // excluded from the escalate-on-ungrounded heuristic (handler policy).
  if (finishReason === "content-filter" || rawFinishReason === "refusal") {
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
    return {
      parts: [...progressParts, refusalPart, helpPart],
      grounded: false,
      terminal: true,
    };
  }

  // ── Phase 2: write ─────────────────────────────────────────────────────────
  // The status the reply is written under. Normally the model's declaration; a
  // phase that ran out of budget mid-gather still has to produce a reply, and
  // the fallback reads the grounding rather than assuming it.
  const sourcesPart = dedupSources(usedSources);
  // `terminal.status` is already the EFFECTIVE status: the tool coerced a
  // second clarification request into a best-effort answer (the anti-loop
  // guarantee), so nothing downstream has to re-derive that rule.
  const status = resolveTerminalStatus(terminal.status, sourcesPart !== null);
  // A clarification is one question, rendered as its own part, so it is
  // collected rather than streamed, and the Visitor never sees a half-question
  // that then turns into a part.
  const streaming = status !== "needs_clarification";

  const write = streamText({
    model: chatModel,
    system: buildSystemPrompt(platformPrompt, assistant, flow, {
      skills,
      memory: session.memory(),
      longTermMemory,
      flowStyle,
      phase: "write",
    }),
    // The gather phase's own messages carry the tool results and the write-time
    // instructions the terminal tool returned, the model writes from what it
    // actually saw, not from a summary we made of it.
    messages: [
      ...history.map((m) => ({ role: m.role, content: m.text })),
      { role: "user" as const, content: message },
      ...(await gather.response).messages,
    ],
    abortSignal: signal,
  });

  let text = "";
  let textOpen = false;
  let writeFinishReason: string | null = null;
  for await (const chunk of write.fullStream) {
    if (chunk.type === "text-delta") {
      if (streaming && !textOpen) {
        emit({ type: "text-start", action: "search_knowledge" });
        textOpen = true;
      }
      text += chunk.text;
      if (streaming) emit({ type: "text-delta", delta: chunk.text });
    } else if (chunk.type === "finish") {
      writeFinishReason = chunk.finishReason;
    } else if (chunk.type === "error") {
      throw chunk.error instanceof Error
        ? chunk.error
        : new Error(errorMessageOf(chunk.error));
    }
  }
  if (textOpen) emit({ type: "text-end" });
  try {
    recordUsage?.(usageTotals(await write.totalUsage));
  } catch {
    // as above
  }

  if (status === "needs_clarification") {
    const question =
      text.trim() ||
      "I want to make sure I look up the right thing: which topic (or which part of the material) are you asking about?";
    const part: ChatReplyPart = {
      type: "clarify",
      action: "search_knowledge",
      question,
    };
    emit({ type: "part", part });
    return { parts: [...progressParts, part], grounded: false, terminal: true };
  }

  // The write phase produced nothing: never leave the Visitor with an empty
  // bubble. What to say depends on what was actually found, so the honest copy
  // is the same two cases the status already distinguishes.
  if (!text.trim()) {
    text =
      sourcesPart === null
        ? "I couldn't find anything about that in the knowledge base. I don't want to guess, so this may be outside the material I have, try rephrasing or narrowing the question, or reach out to support."
        : "I found some relevant material but was cut off before I could summarize it, the sources below are what I pulled up. Try asking a more specific question.";
    emit({
      type: "part",
      part: { type: "text", action: "search_knowledge", text },
    });
  }

  // The narration comes first, in the order the phases ran, the same order the
  // Visitor saw it stream, and the same place the reference platform puts it
  // (there, glued onto the front of the answer string; here, still separable).
  const parts: ChatReplyPart[] = [
    ...progressParts,
    { type: "text", action: "search_knowledge", text },
  ];
  // Output-limit truncation: say so instead of pretending nothing was found.
  if (writeFinishReason === "length") {
    const notePart: ChatReplyPart = {
      type: "text",
      action: "fallback",
      text: "That answer was cut short by the length limit, try asking a more specific question.",
    };
    emit({ type: "part", part: notePart });
    parts.push(notePart);
    return { parts, grounded: false, terminal: true };
  }
  if (sourcesPart) {
    emit({ type: "part", part: sourcesPart });
    parts.push(sourcesPart);
  }
  // `insufficient_information` is exactly the case the flow's escalation toggle
  // exists for, so it is NOT terminal: the handler still gets to offer a desk.
  return {
    parts,
    grounded: sourcesPart !== null && status === "answer",
    terminal: false,
  };
}
