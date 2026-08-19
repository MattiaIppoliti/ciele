/**
 * The one place that flattens a StoredMessage's persisted `content` parts to
 * plain text. `content` is `unknown[]` at the Db interface (the runtime owns
 * the part shapes), so every consumer used to re-invent the same unsafe cast,
 * this helper owns it once: text parts are kept, everything else (buttons,
 * iframes, clarify, sources, …) is skipped, and malformed parts are tolerated.
 */
export function messageText(
  content: readonly unknown[],
  separator = "\n"
): string {
  return content
    .map((p) => {
      const part = p as { type?: string; text?: string };
      return part?.type === "text" ? (part.text ?? "") : "";
    })
    .filter(Boolean)
    .join(separator);
}

/**
 * Whether a persisted message is a proactive Notification, the Assistant speaking
 * unprompted (#546). Read from the parts rather than from a column: the parts are
 * what the runtime emits and every chat surface renders, so there is no second
 * source of truth to keep in step. The SQL Insights aggregate asks the same
 * question with `content @> '[{"type": "notification"}]'`.
 */
export function isProactiveMessage(content: readonly unknown[]): boolean {
  return content.some((p) => (p as { type?: string } | null)?.type === "notification");
}
