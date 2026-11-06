import type { Conversation, StoredMessage } from "@agent-hub/core";
import { effectiveOperatorState, waitExpiresAt, waitTimedOut } from "@agent-hub/core";

/**
 * What the Widget needs to know about who answers its Conversation (#1082,
 * #1083), and the poll cadence that follows from it. Pure, so the "an idle
 * Widget makes no extra requests" rule is tested here rather than in a
 * component vitest cannot load.
 */
export interface WidgetLiveState {
  state: "ai" | "waiting" | "held";
  /** The Member answering, when held. */
  operatorName: string | null;
  /** When an unanswered wait hands back to the AI, when waiting. */
  waitExpiresAt: string | null;
  /** A wait ran out with nobody taking over: tell the Visitor and offer the desk's other channels. */
  waitTimedOut: boolean;
  /** The desk the wait came from, so the Widget can offer its other channels. */
  helpDeskId: string | null;
}

export function widgetLiveState(conversation: Conversation | null, now: Date): WidgetLiveState {
  const operator = conversation?.operator;
  const state = effectiveOperatorState(operator, now);
  return {
    state,
    operatorName: state === "held" ? operator?.memberName ?? null : null,
    waitExpiresAt: state === "waiting" ? waitExpiresAt(operator)?.toISOString() ?? null : null,
    waitTimedOut: waitTimedOut(operator, now),
    helpDeskId: operator?.waitingHelpDeskId ?? null,
  };
}

/**
 * A stored message as a Visitor may see it: the operator's Member id is an
 * internal identifier, so only the display name leaves.
 */
export function widgetMessage(message: StoredMessage): StoredMessage {
  if (!("authorMemberId" in message)) return message;
  const visible = { ...message };
  delete visible.authorMemberId;
  return visible;
}

/** Milliseconds between polls while a person is answering or awaited. */
export const LIVE_POLL_MS = 3_000;

/**
 * How long after the Visitor's last message the Widget keeps a slow check
 * going while the AI answers, so a Member who takes a live Conversation over
 * reaches a Visitor who is still there. After this the Widget is idle and
 * makes no requests at all.
 */
export const LIVE_LINGER_MS = 5 * 60_000;
export const LIVE_LINGER_POLL_MS = 15_000;

/**
 * The delay before the next poll, or null for none. Held or waiting: poll
 * every few seconds. Answered by the AI: a slow check only while the Visitor
 * was active in the last few minutes.
 */
export function nextLivePollDelay(input: {
  state: WidgetLiveState["state"] | null;
  lastVisitorMessageAt: number | null;
  now: number;
}): number | null {
  if (input.state === "held" || input.state === "waiting") return LIVE_POLL_MS;
  if (input.lastVisitorMessageAt === null) return null;
  return input.now - input.lastVisitorMessageAt < LIVE_LINGER_MS ? LIVE_LINGER_POLL_MS : null;
}

/** Appends messages the client has not seen, by id, keeping server order. */
export function mergeById<T extends { id: string }>(seen: readonly T[], incoming: readonly T[]): T[] {
  const ids = new Set(seen.map((message) => message.id));
  return [...seen, ...incoming.filter((message) => !ids.has(message.id))];
}
