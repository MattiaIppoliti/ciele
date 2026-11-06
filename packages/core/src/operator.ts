/**
 * Human operators in a Conversation (#1082, #1083): who answers the Visitor,
 * and when a wait for a person runs out.
 *
 * Pure over the stored `ConversationOperator` and a caller-supplied `now`, so
 * the expiry of a wait is a read-time derivation and no scheduled job has to
 * end it.
 */
import type { ConversationOperator, OperatorState, Role } from "./types";

/** Default minutes a Visitor waits for a Live operator before the AI takes back over. */
export const DEFAULT_WAIT_TIMEOUT_MINUTES = 5;

/** The longest wait a channel may configure, in minutes. */
export const MAX_WAIT_TIMEOUT_MINUTES = 60;

/** A Conversation nobody took over: answered by the AI. */
export const AI_OPERATOR: ConversationOperator = {
  state: "ai",
  memberId: null,
  memberName: null,
  heldAt: null,
  waitingSince: null,
  waitingHelpDeskId: null,
  waitingChannelId: null,
  waitTimeoutMinutes: null,
  assignedMemberId: null,
  assignedAt: null,
};

/** When an unanswered wait hands the Conversation back to the AI; null when not waiting. */
export function waitExpiresAt(operator: ConversationOperator | null | undefined): Date | null {
  if (!operator || operator.state !== "waiting" || !operator.waitingSince) return null;
  const started = Date.parse(operator.waitingSince);
  if (!Number.isFinite(started)) return null;
  const minutes = operator.waitTimeoutMinutes ?? DEFAULT_WAIT_TIMEOUT_MINUTES;
  return new Date(started + minutes * 60_000);
}

/**
 * The state that actually holds at `now`. A wait whose timeout passed is
 * `ai` again even though the row still says `waiting`: the stored row records
 * that a wait started, the clock decides whether it is still on.
 */
export function effectiveOperatorState(
  operator: ConversationOperator | null | undefined,
  now: Date
): OperatorState {
  if (!operator) return "ai";
  if (operator.state === "held") return "held";
  if (operator.state === "waiting") {
    const expires = waitExpiresAt(operator);
    return expires && expires.getTime() > now.getTime() ? "waiting" : "ai";
  }
  return "ai";
}

/** Whether a wait was started and ran out without anybody taking over. */
export function waitTimedOut(
  operator: ConversationOperator | null | undefined,
  now: Date
): boolean {
  return operator?.state === "waiting" && effectiveOperatorState(operator, now) === "ai";
}

/**
 * Whether a Visitor message must be saved without starting a Conversation
 * Turn: a Member holds the Conversation, or the Visitor is waiting for one.
 */
export function suppressesTurn(
  operator: ConversationOperator | null | undefined,
  now: Date
): boolean {
  return effectiveOperatorState(operator, now) !== "ai";
}

/** One row of the Inbox Waiting view. */
export interface WaitingEntry<C> {
  conversation: C;
  waitingSince: string;
  waitedMs: number;
  expiresAt: string;
}

/**
 * The Waiting view: Conversations still waiting at `now`, oldest first. A
 * wait that ran out is not listed, it is the AI's again.
 */
export function waitingQueue<C extends { operator?: ConversationOperator }>(
  conversations: readonly C[],
  now: Date
): WaitingEntry<C>[] {
  const entries: WaitingEntry<C>[] = [];
  for (const conversation of conversations) {
    const operator = conversation.operator;
    if (effectiveOperatorState(operator, now) !== "waiting" || !operator?.waitingSince) continue;
    entries.push({
      conversation,
      waitingSince: operator.waitingSince,
      waitedMs: Math.max(0, now.getTime() - Date.parse(operator.waitingSince)),
      expiresAt: waitExpiresAt(operator)!.toISOString(),
    });
  }
  return entries.sort((a, b) => Date.parse(a.waitingSince) - Date.parse(b.waitingSince));
}

/**
 * Who may take over, answer and release a Conversation (#1082, #1086).
 *
 * Deliberately not a rank comparison: a Support Agent may do this one thing an
 * Editor may do and none of the others, so it is a named check rather than a
 * rung on the Role ladder.
 */
export function canOperateConversations(role: Role | null | undefined): boolean {
  return role === "owner" || role === "admin" || role === "editor" || role === "support_agent";
}
