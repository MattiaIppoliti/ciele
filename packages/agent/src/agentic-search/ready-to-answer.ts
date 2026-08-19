import { tool, type Tool } from "ai";
import { z } from "zod";
import type { TurnTerminalStatus } from "@agent-hub/core";
import type { RuntimeEvent } from "../types";

/**
 * The terminal tool (#558). The model does not merely stop when it is done, it
 * DECLARES that it is done, and in what state. That declaration is what makes
 * two things possible that inference could not:
 *
 *  1. **A two-phase turn.** Phase 1 gathers and may not write a word of answer;
 *     phase 2 writes, and only runs after this tool has been called. So "no
 *     answer text without a terminal declaration" is structural rather than a
 *     rule we hope the model follows.
 *  2. **Late-bound answering style.** The organization's style instructions ride
 *     on THIS tool's result, at the moment of writing, instead of sitting in the
 *     system prompt competing with tool-selection reasoning for the whole loop.
 *
 * It replaces `decideClarify` and the coverage-verdict inference around the old
 * loop: the model knows whether it needs to ask a question or admit it cannot
 * answer, and it says so, in one place, once.
 */

export type TerminalStatus = TurnTerminalStatus;

/** What the model declared, collected per turn. */
export interface TerminalState {
  status: TerminalStatus | null;
  /** Times the tool was called, more than once is a model error worth seeing. */
  calls: number;
  /**
   * True when the model asked to clarify but the conversation had already
   * clarified, so the declaration was coerced to a best-effort answer. The write
   * phase needs to know: its instructions differ from a plain `answer`.
   */
  reClarifyBlocked: boolean;
}

export function createTerminalState(): TerminalState {
  return { status: null, calls: 0, reClarifyBlocked: false };
}

/** Write-time instructions, resolved once the status is known. */
export interface WriteTimeStyle {
  /** The organization's (and flow's) answering-style instructions. */
  answeringStyle?: string;
  /**
   * Whether an earlier turn in THIS conversation already asked a clarifying
   * question. The anti-loop guarantee: a Visitor who has already been asked to
   * rephrase must not be asked again; that is a loop, and it reads as the
   * assistant refusing to try. Derived from the persisted parts upstream.
   *
   * The model is also TOLD this in the gather prompt, so it usually never
   * declares `needs_clarification` in the first place; the coercion here is the
   * guarantee for when it does anyway.
   */
  alreadyClarified?: boolean;
}

/**
 * The result the model reads back. Each status gets a different constraint,
 * because "ask one question", "admit you cannot answer" and "write the answer"
 * are three different jobs and blurring them is how a dead-end turns into
 * invented general knowledge.
 */
export function writeTimeInstructions(
  status: TerminalStatus,
  style: WriteTimeStyle = {},
  options: { reClarifyBlocked?: boolean } = {}
): string {
  const head = options.reClarifyBlocked
    ? "You called ReadyToAnswer asking for clarification, but this conversation has ALREADY asked the visitor to clarify once. Asking again is a loop and reads as refusing to try. Write the best answer you can from what you found instead, and state plainly which part you could not determine and why."
    : status === "needs_clarification"
      ? "You called ReadyToAnswer because clarification is required. The very next thing you write must be ONE concise, user-facing clarification question. Do not answer the original question yet, and do not guess at what they meant."
      : status === "insufficient_information"
        ? "You called ReadyToAnswer with insufficient information. Write a short user-facing message saying you could not find the answer, and recommend they reach out to a human. Do not offer workarounds, and do not fall back on general knowledge the knowledge base did not give you."
        : "You called ReadyToAnswer. Write the final answer now, grounded only in what you actually found. If part of the question is unsupported by what you found, say so plainly rather than filling the gap.";
  const answeringStyle = style.answeringStyle?.trim();
  return answeringStyle
    ? `${head}\n\nAnswering-style instructions from the institution (these take priority over the general guidance above):\n${answeringStyle}`
    : head;
}

/**
 * The tool itself. Its execute records the declaration and hands back the
 * write-time instructions; it performs no work, which is why it is safe to make
 * mandatory, a model can always afford to call it.
 *
 * Deliberately NOT routed through the tool registry's `instrument` wrapper: it
 * spends no iteration (declaring you are done is not a step of work) and its
 * result is the write-time instruction text, which the model acts on rather
 * than reads as an outcome. It still emits the normal tool lifecycle (#574),
 * a `thought` would be hidden from Roles below the reasoning gate, and the
 * terminal declaration is operational fact every Inbox reader may see.
 */
export function readyToAnswerTool(
  state: TerminalState,
  style: WriteTimeStyle,
  emit?: (event: RuntimeEvent) => void
): Tool {
  return tool({
    description:
      "Declare that you have finished gathering and are ready to respond. You MUST call this exactly once before writing anything to the user. Choose the status that matches what you found.",
    inputSchema: z.object({
      status: z
        .enum(["answer", "needs_clarification", "insufficient_information"])
        .describe(
          "answer = you can answer from what you found; needs_clarification = the question is ambiguous and you must ask one question first; insufficient_information = the knowledge base does not contain the answer"
        ),
    }),
    execute: async (input: { status?: unknown }, options) => {
      const declared = normalizeStatus(input.status);
      // The anti-loop guarantee: a conversation that already clarified cannot
      // clarify again, so the declaration is coerced to a best-effort answer and
      // the write-time instructions say why.
      const reClarifyBlocked =
        declared === "needs_clarification" && style.alreadyClarified === true;
      const status: TerminalStatus = reClarifyBlocked ? "answer" : declared;
      state.calls += 1;
      // A second call is a model error, not a state change: the first
      // declaration stands, so a confused model cannot downgrade a real answer
      // into a dead end (or the reverse) on a retry.
      if (state.status === null) {
        state.status = status;
        state.reClarifyBlocked = reClarifyBlocked;
      }
      const callId = options?.toolCallId ?? `ready-${state.calls}`;
      emit?.({
        type: "tool-start",
        callId,
        tool: "readyToAnswer",
        label: "Getting ready to answer…",
        input: { status: declared },
      });
      emit?.({
        type: "tool-end",
        callId,
        tool: "readyToAnswer",
        ok: true,
        summary:
          state.status === "needs_clarification"
            ? "Will ask one clarifying question"
            : state.status === "insufficient_information"
              ? "No answer found in the knowledge base"
              : reClarifyBlocked
                ? "Answering best-effort (already clarified once)"
                : "Ready to answer",
        // Structured so the fold: and the Inbox, read the FINAL status, after
        // the re-clarify coercion, not the raw declaration.
        result: { status: state.status },
        durationMs: 0,
      });
      return {
        acknowledged: true,
        instructions: writeTimeInstructions(state.status, style, {
          reClarifyBlocked: state.reClarifyBlocked,
        }),
        ...(state.calls > 1
          ? { note: "ReadyToAnswer was already called; your first status stands." }
          : {}),
      };
    },
  });
}

/** Unknown or missing status reads as the safest of the three. */
function normalizeStatus(raw: unknown): TerminalStatus {
  const value = String(raw ?? "");
  if (value === "needs_clarification" || value === "insufficient_information") {
    return value;
  }
  if (value === "answer") return "answer";
  // A model that garbled the enum has still told us it is done. Treating that
  // as "answer" would licence an ungrounded reply; the honest default is to let
  // the grounding it actually has decide (see resolveTerminalStatus).
  return "insufficient_information";
}

/**
 * The status the turn will write under. Normally the model's own declaration,
 * but phase 1 can end without one (the iteration budget ran out mid-gather), and
 * phase 2 must still run, because the alternative is an empty bubble.
 *
 * The fallback reads the grounding rather than assuming: sources in hand means
 * there is something to answer from; nothing in hand is a dead end, which is the
 * one thing a Visitor must never have dressed up as an answer.
 */
export function resolveTerminalStatus(
  declared: TerminalStatus | null,
  grounded: boolean
): TerminalStatus {
  if (declared) return declared;
  return grounded ? "answer" : "insufficient_information";
}
