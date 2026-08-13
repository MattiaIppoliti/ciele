import type { HistoryMessage } from "../types";

/**
 * The turn's context frame: the live signals retrieval may use, assembled once
 * and STATED to the model rather than resolved for it.
 *
 * This module used to do more. It carried a deterministic deictic resolver that
 * turned "what about the second one?" into a concrete first query, and a
 * `SearchIntent` the loop was seeded and gated on. That work is the model's now
 * (#558): it has the history in its messages, an iteration budget it knows
 * about, and multi-query search — and the reference platform's traces show the
 * chain of thought resolving exactly these references ("the user has now
 * specified 'final exam' as the quiz") without any of the machinery. What is
 * left here is the part the model genuinely cannot know: which Knowledge
 * Collection this conversation is anchored to. (Remembered facts used to ride
 * the frame too — that rendered every fact into the gather prompt twice,
 * since the system prompt's session/long-term memory blocks are their owner.)
 */

/**
 * The live context available to a turn's retrieval, per the #53 audit. Only
 * these signals actually reach `search_knowledge` today; role / URL / SSO
 * are inert and intentionally excluded.
 */
export interface ContextFrame {
  /** Active Knowledge Collection anchor, or null when the turn is assistant-wide. */
  collectionId: string | null;
  /** Recent transcript of THIS conversation (already capped upstream). */
  history: readonly HistoryMessage[];
}

/** Assembles the {@link ContextFrame} from the live signals. */
export function buildContextFrame(input: {
  collectionId?: string | null;
  history?: readonly HistoryMessage[];
}): ContextFrame {
  return {
    collectionId: input.collectionId ?? null,
    history: input.history ?? [],
  };
}

/**
 * Renders the frame as a prompt block, or undefined when there is nothing worth
 * saying. Scope is the whole content: the model can read its own history, so
 * repeating it here would only spend tokens telling it what it already has.
 *
 * The anchor matters because it silently narrows every search — a model that
 * does not know it is scoped to one Collection cannot tell "the knowledge base
 * does not have this" from "this course does not have this", and those are
 * different answers.
 */
export function describeContextFrame(frame: ContextFrame): string | undefined {
  const lines: string[] = [];
  if (frame.collectionId) {
    lines.push(
      "Every knowledge search this turn is scoped to the Knowledge Collection this conversation is anchored to. If something is missing, it may exist elsewhere in the organization's knowledge — say that it is not in this collection rather than that it does not exist."
    );
  }
  if (lines.length === 0) return undefined;
  return ["# Retrieval context for this turn", ...lines].join("\n");
}
