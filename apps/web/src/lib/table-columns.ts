/**
 * Column widths for the console's tables: what a drag resolves to, and what
 * survives a reload.
 *
 * Pure, and separate from the hook, for the reason the rest of `lib/` is:
 * vitest never collects a `.tsx`. The rule this file exists to keep is the
 * one every hand-rolled resize in this repo has got wrong at least once, and
 * `packages/ui/src/resize-geometry.ts` already states for panels: the edge
 * follows the **grab point**, not the pointer. A handle straddles the border
 * it drags, so reading `clientX` straight into a width teleports the column
 * by half the handle on the first move.
 *
 * Unlike a panel, a column does not rubber-band at its bounds. A panel's
 * minimum is a suggestion the reader is pushing against; a column's is the
 * width below which its content is gone, and resisting there reads as the
 * table fighting back rather than as a limit.
 */

/** Keep enough room for a heading and its controls. */
export const MIN_COLUMN_WIDTH = 120;
/** Wide enough for a long URL, narrow enough that one column cannot eat the table. */
export const MAX_COLUMN_WIDTH = 900;

export interface ColumnWidthInput {
  /** Current pointer position, `clientX`. */
  pointer: number;
  /** `grabOffsetFor(columnRight, pointerAtPointerDown)`. */
  grabOffset: number;
  /** The column's left edge in viewport coordinates, from its own rect. */
  left: number;
  minWidth?: number;
  maxWidth?: number;
}

/** The width a column should render for the current pointer position. */
export function columnWidthFor({
  pointer,
  grabOffset,
  left,
  minWidth = MIN_COLUMN_WIDTH,
  maxWidth = MAX_COLUMN_WIDTH,
}: ColumnWidthInput): number {
  const edge = pointer - grabOffset;
  return Math.round(Math.min(maxWidth, Math.max(minWidth, edge - left)));
}

/**
 * Where a table's widths are kept. Per table rather than per column, so one
 * read and one write carry the whole layout, and namespaced so a table can be
 * renamed without inheriting a stranger's columns.
 */
export function columnWidthsKey(tableId: string): string {
  return `ciele.table-widths.${tableId}`;
}

/**
 * Reads a stored layout, keeping only the columns the table still has and
 * only widths inside the bounds.
 *
 * Everything here is defensive on purpose: the value comes from a browser
 * store that a person can edit, that survives a release in which a column was
 * renamed or removed, and that in a private window throws on access rather
 * than answering. A column whose width does not survive falls back to the
 * layout's own default, which is always a sane one.
 */
export function parseColumnWidths(
  raw: string | null,
  keys: readonly string[]
): Record<string, number> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const allowed = new Set(keys);
  const widths: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!allowed.has(key)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (value < MIN_COLUMN_WIDTH || value > MAX_COLUMN_WIDTH) continue;
    widths[key] = Math.round(value);
  }
  return widths;
}

/** Fit flexible columns to the viewport, retaining their readable floors. */
export function fitColumnWidths(columns: readonly { key: string; width: number; min: number; fixed?: boolean }[], available: number, chosen: Readonly<Record<string, number>> = {}): Record<string, number> {
  // Readable starting floors must not undo an explicit resize on release.
  // Other columns absorb spare room; chosen columns keep their exact width.
  columns = columns.map((column) => !column.fixed && chosen[column.key] !== undefined
    ? { ...column, width: Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, chosen[column.key]!)), fixed: true }
    : column);
  const fixed = columns.filter((column) => column.fixed).reduce((sum, column) => sum + column.width, 0);
  const flexible = columns.filter((column) => !column.fixed);
  const floor = flexible.reduce((sum, column) => sum + column.min, 0);
  const preferred = flexible.reduce((sum, column) => sum + Math.max(column.min, column.width), 0);
  const room = Math.max(floor, available - fixed);
  const ratio = preferred > floor ? Math.min(1, (room - floor) / (preferred - floor)) : 0;
  const extra = Math.max(0, room - preferred) / Math.max(1, flexible.length);
  return Object.fromEntries(columns.map((column) => [column.key, column.fixed ? column.width : column.min + (Math.max(column.min, column.width) - column.min) * ratio + extra]));
}

/** Saved layouts retain each width even when the viewport changes. */
export function resolveColumnWidths(columns: readonly { key: string; width: number; min: number; max?: number; fixed?: boolean }[], available: number, stored: Record<string, number>): Record<string, number> {
  if (!Object.keys(stored).length) return available ? fitColumnWidths(columns, available) : Object.fromEntries(columns.map((column) => [column.key, column.width]));
  return Object.fromEntries(columns.map((column) => [column.key, column.fixed ? column.width : Math.min(column.max ?? MAX_COLUMN_WIDTH, Math.max(column.min, stored[column.key] ?? column.width))]));
}
