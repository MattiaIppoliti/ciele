/**
 * Reply Components: the shape rules for the closed catalogue of components an
 * Assistant may render inside a reply (see `render-tools.ts` for the tools that
 * emit them, and `context.md` for the term).
 *
 * **One normalizer, four callers.** The bounds and the squaring rule are needed
 * by the zod schema that validates the model's arguments, by the part builder
 * that emits the part, by the Inbox export that flattens it back to text, and
 * by the live client that renders it from arguments still streaming in. Those
 * four had three copies of the rule between them, and the copies had already
 * diverged: two filtered non-string cells out before indexing, which shifted
 * every later cell one column left and silently misfiled data. This module is
 * that rule, once.
 *
 * Deliberately dependency-free (no zod, no AI SDK), because `client.ts`
 * re-exports it and the live client's *provisional* render needs the caps as
 * much as the server does: props parsed out of a half-written argument stream
 * have passed through no schema at all.
 */

/** Ceilings a Reply Component's props are held to, wherever they arrive from. */
export const REPLY_COMPONENT_LIMITS = {
  tableRows: 20,
  tableColumns: 6,
  tableCellChars: 300,
  tableLabelChars: 300,
} as const;

/** A table's props, squared, capped and safe to render. */
export interface NormalizedTable {
  title: string | null;
  caption: string | null;
  columns: string[];
  /** Always `columns.length` cells wide. */
  rows: string[][];
  /**
   * Per-row follow-up prompt, `null` where the row has none. Parallel to
   * `rows`, so `askAbout[i]` belongs to `rows[i]`.
   */
  askAbout: Array<string | null>;
}

function label(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** One cell: a non-string is an empty cell, never a reason to shift the row. */
function cell(value: unknown): string {
  return typeof value === "string"
    ? value.slice(0, REPLY_COMPONENT_LIMITS.tableCellChars)
    : "";
}

/**
 * Normalizes anything claiming to be table props. Returns null while there is
 * nothing to draw, which is also the answer for a stream that has produced no
 * column headers yet.
 */
export function normalizeTable(props: unknown): NormalizedTable | null {
  if (!props || typeof props !== "object" || Array.isArray(props)) return null;
  const raw = props as Record<string, unknown>;
  if (!Array.isArray(raw.columns)) return null;
  const columns = raw.columns
    .slice(0, REPLY_COMPONENT_LIMITS.tableColumns)
    .map((column) => cell(column));
  if (columns.length === 0) return null;

  const rawRows = Array.isArray(raw.rows) ? raw.rows : [];
  const rows = rawRows
    .slice(0, REPLY_COMPONENT_LIMITS.tableRows)
    .map((row) => {
      const cells = Array.isArray(row) ? row : [];
      // Positional: `cells[i]` belongs to `columns[i]`, whatever its type.
      return columns.map((_column, index) => cell(cells[index]));
    });

  const rawAsk = Array.isArray(raw.askAbout) ? raw.askAbout : [];
  return {
    title: label(raw.title, REPLY_COMPONENT_LIMITS.tableLabelChars),
    caption: label(raw.caption, REPLY_COMPONENT_LIMITS.tableLabelChars),
    columns,
    rows,
    // Only as long as `rows`: a prompt with no row to sit on is dropped.
    askAbout: rows.map((_row, index) =>
      label(rawAsk[index], REPLY_COMPONENT_LIMITS.tableLabelChars)
    ),
  };
}

/**
 * Removes the arguments that are not props from a streamed tool-call payload.
 *
 * `progress` is the Simplified-thinking narration (#560), and it rides the same
 * argument JSON that `tool-input-delta` carries, so without this the live
 * client would parse the narration line into the component's props. The runtime
 * strips it on the execute path too (`takeProgress` in `tools.ts`); this is the
 * same removal for the path that never reaches execute.
 */
export function stripNonProps(
  props: Record<string, unknown>
): Record<string, unknown> {
  const { progress: _progress, ...rest } = props;
  return rest;
}
