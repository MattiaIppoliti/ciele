import {
  consumeTurnStream,
  type ConsumeTurnOptions,
  type TurnView,
} from "@agent-hub/agent/client";

/**
 * One Conversation Turn as a chat surface runs it: the Preview, the Widget,
 * a Teammate chat and the Flows Agent all send a message, stream the reply
 * into their newest bot bubble and swap the placeholder id for the persisted
 * one when the turn is done. They each wrote that loop themselves, in `.tsx`
 * files no test reaches, and the copies had already drifted: two patched "the
 * last bot" and two patched "the last row, if it is a bot".
 *
 * What stays with each surface is what genuinely differs: its message shape,
 * its request body, its sounds, and what it shows when a turn fails (the
 * Widget stays silent, the console toasts).
 */

/** A bot bubble a turn can stream into: any TurnView with a persisted id slot. */
export type StreamingBot = TurnView & { role: "bot"; id: string | null };

/**
 * Applies `fn` to the newest bot message, searching back past rows that are
 * not bots (a Channel notice, a queued user message). Returns the same list
 * when there is no bot, so a React state setter sees no change.
 */
export function patchLastBot<M extends { role: string }>(
  messages: readonly M[],
  fn: (bot: Extract<M, { role: "bot" }>) => Extract<M, { role: "bot" }>,
): M[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "bot") {
      const next = [...messages];
      next[i] = fn(messages[i] as Extract<M, { role: "bot" }>);
      return next;
    }
  }
  return messages as M[];
}

export type TurnOutcome =
  | { status: "done" }
  /** Stopped by the Member or the Visitor leaving: not an error to report. */
  | { status: "aborted" }
  | { status: "failed"; error: Error };

export interface RunTurnOptions<B extends StreamingBot>
  extends Pick<ConsumeTurnOptions<B>, "update" | "onStart" | "onEvent" | "errorText"> {
  /**
   * Sends the message. Receives the signal to pass to `fetch` and the turn id
   * to put in the body; a fresh id per turn is what lets the server tell a
   * retry from a new message.
   */
  request: (signal: AbortSignal | undefined, turnId: string) => Promise<Response>;
  /** Aborts the turn (a Stop button). Optional: some surfaces cannot stop. */
  signal?: AbortSignal;
  /** Fires after the persisted id has been swapped into the bot bubble. */
  onDone?: (done: { conversationId: string; messageId: string | null }) => void;
  /** The failure text for a non-OK response. Default: "Chat failed (status)". */
  failure?: (status: number) => string;
}

/**
 * Runs one turn to its end and says how it ended. It never throws: an abort
 * and a failure are both outcomes, because every surface handled them
 * differently and one of them used to swallow both.
 */
export async function runTurn<B extends StreamingBot>(options: RunTurnOptions<B>): Promise<TurnOutcome> {
  const { request, signal, update, onStart, onEvent, onDone, errorText, failure } = options;
  try {
    const response = await request(signal, crypto.randomUUID());
    if (!response.ok || !response.body) {
      throw new Error(failure ? failure(response.status) : `Chat failed (${response.status})`);
    }
    await consumeTurnStream<B>(response.body, {
      update,
      onStart,
      onEvent,
      errorText,
      onDone: (done) => {
        update((bot) => ({ ...bot, id: done.messageId }));
        onDone?.(done);
      },
    });
    return { status: "done" };
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      return { status: "aborted" };
    }
    return { status: "failed", error: error instanceof Error ? error : new Error(String(error)) };
  }
}
