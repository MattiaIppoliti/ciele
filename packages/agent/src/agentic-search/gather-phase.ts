import { streamText, stepCountIs } from "ai";
import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import type { ChatReplyPart, ReplyComponentName, RuntimeEvent } from "../types";
import { replyComponentFor } from "../render-tools";
import { recordStreamUsage } from "../usage";
import { errorMessageOf } from "../telemetry";
import { searchBudgetExhausted, type SearchPass } from "./search-pass";
import { MAX_AGENT_ITERATIONS, type LoopBudget } from "./loop-budget";
import type { TerminalState } from "./ready-to-answer";

/**
 * Phase 1 of the two-phase turn (#558): tools are available and the model may
 * not address the user. Everything it writes here is private reasoning, which
 * is what makes "no answer text without a terminal declaration" structural
 * rather than a hope. This module owns the gather stream's consumption: the
 * live thought-deltas, the flush-on-tool-call cadence, the stop conditions and
 * the finish-reason capture; `runAgenticSearch` keeps the sequencing.
 *
 * A safety refusal is one of this phase's finish reasons, so its detection and
 * its copy both live here rather than with the write phase, which never runs
 * on a refusal.
 */

/** Safety refusal (#583): a distinct stop reason on a successful response. */
export function isRefusal(
  finishReason: string | null,
  rawFinishReason: string | undefined
): boolean {
  return finishReason === "content-filter" || rawFinishReason === "refusal";
}

/**
 * Answer a refusal honestly and offer the human exit ramp. Never dressed up
 * as a knowledge gap, never retried on another provider, and excluded from
 * the escalate-on-ungrounded heuristic (handler policy).
 */
export function refusalParts(options: {
  contactLabel: string;
  /** Provider diagnostics may be shown on the admin Preview surface only. */
  previewSurface?: boolean;
  rawFinishReason?: string;
}): [ChatReplyPart, ChatReplyPart] {
  return [
    {
      type: "text",
      action: "refusal",
      text:
        "I can't help with that request." +
        (options.previewSurface && options.rawFinishReason
          ? ` (Provider finish reason: ${options.rawFinishReason}.)`
          : ""),
    },
    {
      type: "help_desk",
      action: "suggest_help_desk",
      label: options.contactLabel,
    },
  ];
}

export interface GatherPhaseInput {
  chatModel: LanguageModel;
  system: string;
  /** The conversation so far, ending with the user's message. */
  messages: ModelMessage[];
  tools: ToolSet;
  loop: LoopBudget;
  terminal: TerminalState;
  searchPasses: SearchPass[];
  emit: (event: RuntimeEvent) => void;
  signal?: AbortSignal;
  recordUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
}

export interface GatherPhaseResult {
  finishReason: string | null;
  rawFinishReason?: string;
  /** The model refused: the turn ends here, on `refusalParts`. */
  refused: boolean;
  /**
   * The phase's own messages: tool calls, results, write-time instructions.
   * Empty on a refusal, which never reaches the write phase that reads them.
   */
  responseMessages: ModelMessage[];
}

export async function runGatherPhase(
  input: GatherPhaseInput
): Promise<GatherPhaseResult> {
  const { loop, terminal, searchPasses, emit } = input;
  const gather = streamText({
    model: input.chatModel,
    system: input.system,
    messages: input.messages,
    tools: input.tools,
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
    abortSignal: input.signal,
  });

  let reasoning = "";
  // Chars of `reasoning` already streamed as thought-deltas (#584). Deltas are
  // withheld while the accumulation is pure whitespace, so a model that emits
  // a stray newline never opens an empty thought in the panel.
  let streamed = 0;
  let finishReason: string | null = null;
  let rawFinishReason: string | undefined;
  // Render-only calls whose arguments are streaming, by tool-call id. A
  // render tool's arguments ARE its component's props, so they go to the
  // client as the model writes them and the component materializes instead of
  // popping in finished. Every other tool's arguments arrive whole on
  // `tool-start`, by which time its panel label is already written, so
  // streaming them would be wire traffic for nothing.
  const renderCalls = new Map<string, ReplyComponentName>();
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
    } else if (chunk.type === "tool-input-start") {
      const component = replyComponentFor(chunk.toolName);
      if (component) {
        renderCalls.set(chunk.id, component);
        emit({
          type: "tool-input-start",
          callId: chunk.id,
          tool: chunk.toolName,
          name: component,
        });
      }
    } else if (chunk.type === "tool-input-delta") {
      // Only for a render call, and only ever forwarded: parsing the
      // accumulation into props is the client's job (`parsePartialJson`).
      if (renderCalls.has(chunk.id)) {
        emit({ type: "tool-input-delta", callId: chunk.id, delta: chunk.delta });
      }
    } else if (chunk.type === "tool-error") {
      // A call that never reached its tool: the AI SDK validates arguments
      // against the input schema before execute, so a malformed or over-cap
      // payload produces no tool-start and no tool-end. For a render call that
      // would leave the client holding a component skeleton forever, so the
      // end of the call is reported here. The trace is unaffected: the fold
      // finds no step with this id, because none was ever opened.
      if (renderCalls.delete(chunk.toolCallId)) {
        emit({
          type: "tool-end",
          callId: chunk.toolCallId,
          tool: chunk.toolName,
          ok: false,
          summary: "Arguments rejected",
          durationMs: 0,
        });
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
  await recordStreamUsage(gather.totalUsage, input.recordUsage);

  const refused = isRefusal(finishReason, rawFinishReason);
  return {
    finishReason,
    rawFinishReason,
    refused,
    // Only the write phase reads these, so a refusal never waits on the
    // response to resolve.
    responseMessages: refused ? [] : (await gather.response).messages,
  };
}
