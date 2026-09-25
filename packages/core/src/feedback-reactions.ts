import type { FeedbackReactionId } from "./types";

/** One vocabulary for the widget, Inbox transcript and feedback reporting. */
export const FEEDBACK_REACTIONS: ReadonlyArray<{
  id: FeedbackReactionId;
  emoji: string;
  label: string;
  score: -1 | 0 | 1;
}> = [
  { id: "positive", emoji: "🙂", label: "Positive response", score: 1 },
  { id: "neutral", emoji: "😐", label: "Neutral response", score: 0 },
  { id: "negative", emoji: "🙁", label: "Negative response", score: -1 },
];

export function isFeedbackReactionId(value: unknown): value is FeedbackReactionId {
  return typeof value === "string" && FEEDBACK_REACTIONS.some((reaction) => reaction.id === value);
}

export function feedbackReactionById(id: FeedbackReactionId | null | undefined) {
  return id ? FEEDBACK_REACTIONS.find((reaction) => reaction.id === id) ?? null : null;
}

/** Map each emoji to the existing positive/negative analytics score. */
export function feedbackReactionScore(id: FeedbackReactionId | null): -1 | 0 | 1 {
  if (!id) return 0;
  return feedbackReactionById(id)?.score ?? 0;
}
