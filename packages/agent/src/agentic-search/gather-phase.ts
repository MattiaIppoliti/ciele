import { streamText } from "ai";
import { dispatchToolBatch, modelToolDeclarations } from "../tool-batch";
import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import type { ChatReplyPart, ReplyComponentName, RuntimeEvent } from "../types";
import {
  RENDER_TABLE_COMPONENT,
  RENDER_TABLE_TOOL_NAME,
} from "../render-tools";
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
  projectContext?: (system: string, evidence: ModelMessage[], tools?: ToolSet) => Promise<ModelMessage[]>;
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
  const responseMessages: ModelMessage[] = [];
  let finishReason: string | null = null;
  let rawFinishReason: string | undefined;
  const declarations = modelToolDeclarations(input.tools);
  for (let step = 0; step < MAX_AGENT_ITERATIONS + 2; step += 1) {
    input.signal?.throwIfAborted();
    const requestMessages = input.projectContext ? await input.projectContext(input.system, responseMessages, declarations) : [...input.messages, ...responseMessages];
    const gather = streamText({
      model: input.chatModel,
      system: input.system,
      messages: requestMessages,
      tools: declarations,
      abortSignal: input.signal,
    });

    let reasoning = "";
    // Chars of `reasoning` already streamed as thought-deltas (#584). Deltas are
    // withheld while the accumulation is pure whitespace, so a model that emits
    // a stray newline never opens an empty thought in the panel.
    let streamed = 0;
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
        if (chunk.toolName === "createStudyExercise") {
          // A progress label only: the arguments include the private answer key.
          emit({ type: "notice", label: "Creating study exercise…" });
        }
        const component =
          chunk.toolName === RENDER_TABLE_TOOL_NAME
            ? RENDER_TABLE_COMPONENT
            : undefined;
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
    // Meter each completed request, before tool dispatch or another request can
    // fail. Never replace these completed calls with a final phase aggregate.
    await recordStreamUsage(gather.totalUsage, input.recordUsage);
    if (isRefusal(finishReason, rawFinishReason)) break;
    responseMessages.push(...await gather.responseMessages);
    const completeBatch = await gather.toolCalls;
    if (new Set(completeBatch.map(call => call.toolCallId)).size !== completeBatch.length) throw new Error("Duplicate tool call ID in model step");
    const calls = completeBatch.filter(call => !call.providerExecuted && !call.invalid);
    if (calls.length === 0) {
      if (completeBatch.some(call => call.invalid && !call.providerExecuted)) {
        loop.endStep();
        if (loop.iteration < loop.limit) continue;
      }
      break;
    }
    const results = await dispatchToolBatch({
      calls,
      tools: input.tools,
      messages: requestMessages,
      signal: input.signal,
      stopped: () => terminal.status !== null,
      skipped: (call, reason) => emit({ type: "tool-end", callId: call.toolCallId, tool: call.toolName, ok: false, summary: reason, durationMs: 0 }),
    });
    responseMessages.push({ role: "tool", content: results });
    loop.endStep();
    input.signal?.throwIfAborted();
    if (terminal.status !== null || loop.iteration >= loop.limit || searchBudgetExhausted(searchPasses)) break;
  }

  const refused = isRefusal(finishReason, rawFinishReason);
  return {
    finishReason,
    rawFinishReason,
    refused,
    // Only the write phase reads these, so a refusal never waits on the
    // response to resolve.
    // In AI SDK 7 `response.messages` belongs only to the final step.
    // Writing needs the complete search/read transcript, not just the
    // readyToAnswer acknowledgement.
    responseMessages: refused ? [] : responseMessages,
  };
}
