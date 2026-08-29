import { streamText } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
import type { ChatReplyPart, RuntimeEvent } from "../types";
import { recordStreamUsage } from "../usage";
import { errorMessageOf } from "../telemetry";

/**
 * Phase 2 of the two-phase turn (#558): no tools, the model writes the reply
 * from what the gather phase actually saw. This module owns the write stream's
 * consumption and the terminal copy for every ending this phase can produce,
 * the clarify fallback question, the empty-write fallback and the
 * length-truncation notice, so each is one direct assertion instead of a full
 * agent-loop round trip. A refusal never reaches here: the gather phase both
 * detects it and owns its copy (gather-phase.ts).
 */

/** The clarification question, or the honest fallback when the model wrote none. */
export function clarifyQuestion(text: string): string {
  return (
    text.trim() ||
    "I want to make sure I look up the right thing: which topic (or which part of the material) are you asking about?"
  );
}

/**
 * The write phase produced nothing: never leave the Visitor with an empty
 * bubble. What to say depends on what was actually found, so the honest copy
 * is the same two cases the terminal status already distinguishes.
 */
export function emptyWriteText(hasSources: boolean): string {
  return hasSources
    ? "I found some relevant material but was cut off before I could summarize it, the sources below are what I pulled up. Try asking a more specific question."
    : "I couldn't find anything about that in the knowledge base. I don't want to guess, so this may be outside the material I have, try rephrasing or narrowing the question, or reach out to support.";
}

/** Output-limit truncation: say so instead of pretending nothing was found. */
export function lengthNoticePart(): ChatReplyPart {
  return {
    type: "text",
    action: "fallback",
    text: "That answer was cut short by the length limit, try asking a more specific question.",
  };
}

export interface WritePhaseInput {
  chatModel: LanguageModel;
  system: string;
  /** History + user message + the gather phase's own messages. */
  messages: ModelMessage[];
  /**
   * Whether the text streams to the Visitor as it is written. A clarification
   * is one question rendered as its own part, so it is collected instead, and
   * the Visitor never sees a half-question that then turns into a part.
   */
  streaming: boolean;
  emit: (event: RuntimeEvent) => void;
  signal?: AbortSignal;
  recordUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
}

export interface WritePhaseResult {
  text: string;
  finishReason: string | null;
}

/** How the write phase ended, and the copy that ending calls for. */
export interface WriteEnding {
  /** The answer text: the model's own, or the fallback when it wrote none. */
  text: string;
  /**
   * The model wrote nothing and `text` is the stand-in. The caller emits it as
   * a part, since nothing was streamed to the Visitor to emit it already.
   */
  fellBack: boolean;
  /** Appended when the output limit cut the answer off, otherwise null. */
  lengthNotice: ChatReplyPart | null;
}

/**
 * What a finished write stream actually says. Both endings the stream itself
 * decides, an empty write and a length cutoff, resolve here rather than in the
 * caller's sequencing, so "the model wrote nothing, with sources" maps to its
 * copy in one tested step. (The clarify ending stays with the caller: it
 * returns a different kind of part and ends the turn.)
 */
export function resolveWriteEnding(
  result: WritePhaseResult,
  hasSources: boolean
): WriteEnding {
  const fellBack = !result.text.trim();
  return {
    text: fellBack ? emptyWriteText(hasSources) : result.text,
    fellBack,
    lengthNotice: result.finishReason === "length" ? lengthNoticePart() : null,
  };
}

export async function runWritePhase(
  input: WritePhaseInput
): Promise<WritePhaseResult> {
  const { streaming, emit } = input;
  const write = streamText({
    model: input.chatModel,
    system: input.system,
    messages: input.messages,
    abortSignal: input.signal,
  });

  let text = "";
  let textOpen = false;
  let finishReason: string | null = null;
  for await (const chunk of write.fullStream) {
    if (chunk.type === "text-delta") {
      if (streaming && !textOpen) {
        emit({ type: "text-start", action: "search_knowledge" });
        textOpen = true;
      }
      text += chunk.text;
      if (streaming) emit({ type: "text-delta", delta: chunk.text });
    } else if (chunk.type === "finish") {
      finishReason = chunk.finishReason;
    } else if (chunk.type === "error") {
      throw chunk.error instanceof Error
        ? chunk.error
        : new Error(errorMessageOf(chunk.error));
    }
  }
  if (textOpen) emit({ type: "text-end" });
  await recordStreamUsage(write.totalUsage, input.recordUsage);
  return { text, finishReason };
}
