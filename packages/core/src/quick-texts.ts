/**
 * Quick Texts in the Inbox reply box (#1085): which saved replies match what
 * the Member typed after `/`, and where that `/` query is in the draft.
 */

/** Most matches the picker shows at once. */
export const QUICK_TEXT_PICKER_LIMIT = 8;

/**
 * Quick Texts whose title contains every word of the query, case- and
 * accent-insensitive. Titles that start with the query come first, then by
 * folder and title, so the list is stable while the Member types.
 */
export function filterQuickTexts<T extends { title: string; folder?: string | null }>(
  quickTexts: readonly T[],
  query: string,
  limit = QUICK_TEXT_PICKER_LIMIT
): T[] {
  const fold = (value: string) =>
    value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
  const needle = fold(query);
  const words = needle.split(/\s+/).filter(Boolean);
  const matches = quickTexts.filter((quickText) => {
    const title = fold(quickText.title);
    return words.every((word) => title.includes(word));
  });
  return matches
    .sort((a, b) => {
      const aStarts = fold(a.title).startsWith(needle) ? 0 : 1;
      const bStarts = fold(b.title).startsWith(needle) ? 0 : 1;
      return (
        aStarts - bStarts ||
        (a.folder ?? "").localeCompare(b.folder ?? "") ||
        a.title.localeCompare(b.title)
      );
    })
    .slice(0, limit);
}

/** The `/query` being typed at the cursor, with where it starts; null when none. */
export interface SlashQuery {
  query: string;
  /** Index of the `/` in the draft. */
  start: number;
}

/**
 * The `/` trigger: a slash at the start of the draft or after whitespace,
 * followed by the text up to the cursor with no line break. A slash inside a
 * word (a URL, "and/or") is not a trigger.
 */
export function slashQueryAt(draft: string, cursor: number): SlashQuery | null {
  const before = draft.slice(0, cursor);
  const match = /(^|\s)\/([^\n/]*)$/.exec(before);
  if (!match) return null;
  return { query: match[2]!, start: before.length - match[2]!.length - 1 };
}

/** The draft with the `/query` at `slash` replaced by `body`, and where the cursor goes after it. */
export function insertQuickText(
  draft: string,
  slash: SlashQuery,
  cursor: number,
  body: string
): { text: string; cursor: number } {
  const text = draft.slice(0, slash.start) + body + draft.slice(cursor);
  return { text, cursor: slash.start + body.length };
}
