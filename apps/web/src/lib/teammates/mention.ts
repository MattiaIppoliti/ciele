import type { ChannelRosterEntry } from "@agent-hub/core";

/**
 * The @ picker's logic (#778): what token the caret is inside, who matches it,
 * and what the text becomes when a name is picked.
 *
 * Pure and separate from the composer component because vitest only runs `.ts`
 * files here (see apps/web/CLAUDE.md), and because these three answers have to
 * agree with `parseChannelMentions` in `@agent-hub/core`: a name the picker
 * inserts must be a name the resolver later finds. That is why matching is
 * case-insensitive and why names keep their spaces, the resolver reads both.
 */

/** Someone the picker can offer: a roster entry plus what the list renders. */
export interface MentionTarget extends ChannelRosterEntry {
  /** Seed for the generated face, resolved by the caller (`rosterAvatarSeed`). */
  avatarSeed: string;
  /** A Teammate's title, shown small under the name. */
  title?: string;
}

/** The @token under the caret: where its `@` sits, and what follows it. */
export interface ActiveMention {
  /** Index of the `@` itself. */
  start: number;
  /** What was typed after the `@`, up to the caret. */
  query: string;
}

/**
 * Roster names contain spaces ("Chief of Staff"), so the query may too; the
 * cap keeps a lone `@` in running prose from reopening the list forever.
 */
const QUERY_LIMIT = 32;

/**
 * The mention token the caret is inside, or null when it is not in one.
 *
 * An `@` only opens a mention at the start of the text, a line, or after
 * whitespace, mirroring nothing about the resolver (which reads every `@`) but
 * everything about typing: `name@example.com` must not pop a list. The token
 * ends at the caret, and a newline before the caret ends it too.
 */
export function activeMention(
  text: string,
  caret: number
): ActiveMention | null {
  const upto = text.slice(0, caret);
  const start = upto.lastIndexOf("@");
  if (start === -1) return null;
  const before = upto[start - 1];
  if (before && !/\s/.test(before)) return null;
  const query = upto.slice(start + 1);
  if (query.includes("\n") || query.length > QUERY_LIMIT) return null;
  return { start, query };
}

/**
 * Who the token matches, Teammates first because they are the ones an `@`
 * actually summons; people follow, since naming a colleague is still worth
 * completing. Prefix matches beat substring matches within each kind, so
 * typing `A` puts Ada above Sam even though both contain an "a".
 */
export function mentionMatches(
  targets: readonly MentionTarget[],
  query: string
): MentionTarget[] {
  const needle = query.trim().toLowerCase();
  const named = targets.filter((target) => target.name.trim().length > 0);
  const pool = needle
    ? named.filter((target) => target.name.toLowerCase().includes(needle))
    : named;
  const rank = (target: MentionTarget) =>
    (target.kind === "teammate" ? 0 : 2) +
    (needle && !target.name.toLowerCase().startsWith(needle) ? 1 : 0);
  return [...pool].sort((a, b) => rank(a) - rank(b));
}

/**
 * The text after picking a name: the token (from its `@` to the caret) becomes
 * `@Name ` and the caret lands after the trailing space, ready to keep typing.
 */
export function insertMention(
  text: string,
  mention: ActiveMention,
  caret: number,
  name: string
): { text: string; caret: number } {
  const inserted = `@${name} `;
  return {
    text: text.slice(0, mention.start) + inserted + text.slice(caret),
    caret: mention.start + inserted.length,
  };
}
