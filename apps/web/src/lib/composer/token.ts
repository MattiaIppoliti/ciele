/**
 * The composer's trigger tokens: what the caret is inside, and what the text
 * becomes when something is picked.
 *
 * Extracted from the channel `@` picker (#778) when a second and a third
 * trigger appeared: `@` in the widget names a help desk, `/` in either surface
 * names a Skill. The three differ entirely in what they offer and what picking
 * one *does* — one inserts a name, one opens a panel, one replaces the draft —
 * and not at all in how a token is found under a caret. Only the second half
 * is here.
 *
 * Pure and separate from the components because vitest only runs `.ts` files in
 * this app (see apps/web/CLAUDE.md).
 */

/** The token under the caret: where its trigger sits, and what follows it. */
export interface ActiveToken {
  /** Index of the trigger character itself. */
  start: number;
  /** What was typed after it, up to the caret. */
  query: string;
}

/**
 * Names contain spaces ("Chief of Staff"), so the query may too; the cap keeps
 * a lone trigger in running prose from reopening the list forever.
 */
const QUERY_LIMIT = 32;

/**
 * The token the caret is inside, or null when it is not in one.
 *
 * A trigger only opens a token at the start of the text, a line, or after
 * whitespace. That mirrors nothing about any resolver and everything about
 * typing: `name@example.com` must not pop a list, and neither must the slash in
 * `and/or`. The token ends at the caret, and a newline before the caret ends it
 * too.
 */
export function activeToken(
  text: string,
  caret: number,
  trigger: string
): ActiveToken | null {
  const upto = text.slice(0, caret);
  const start = upto.lastIndexOf(trigger);
  if (start === -1) return null;
  const before = upto[start - 1];
  if (before && !/\s/.test(before)) return null;
  const query = upto.slice(start + trigger.length);
  if (query.includes("\n") || query.length > QUERY_LIMIT) return null;
  return { start, query };
}

/**
 * The text after picking: the token (from its trigger to the caret) becomes
 * `replacement`, and the caret lands at the end of it.
 *
 * The replacement carries its own trailing space when it wants one. A `@Name `
 * is being typed into a sentence and needs it; a Skill starter is the whole
 * message and does not.
 */
export function replaceToken(
  text: string,
  token: ActiveToken,
  caret: number,
  replacement: string
): { text: string; caret: number } {
  return {
    text: text.slice(0, token.start) + replacement + text.slice(caret),
    caret: token.start + replacement.length,
  };
}

/**
 * Who the token matches, by name, case-insensitively.
 *
 * `priority` breaks ties between kinds that are not peers: in a channel a
 * Teammate outranks a person, because an `@` there actually summons one.
 * Within a priority, a prefix match beats a substring match, so typing `A` puts
 * Ada above Sam even though both contain an "a".
 */
export function matchByName<T extends { name: string }>(
  items: readonly T[],
  query: string,
  priority: (item: T) => number = () => 0
): T[] {
  const needle = query.trim().toLowerCase();
  const named = items.filter((item) => item.name.trim().length > 0);
  const pool = needle
    ? named.filter((item) => item.name.toLowerCase().includes(needle))
    : named;
  const rank = (item: T) =>
    priority(item) * 2 +
    (needle && !item.name.toLowerCase().startsWith(needle) ? 1 : 0);
  return [...pool].sort((a, b) => rank(a) - rank(b));
}
