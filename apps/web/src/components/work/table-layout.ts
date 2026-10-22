/**
 * The Table layout's columns as a Member keeps them (#1050, #1064): their
 * order, which are hidden, and their widths. Stored through the console's
 * table preferences (`ui/table-preferences`), which scope every key to the
 * Organization and the Member and keep a list of strings, so each fact here is
 * written as one: a hidden column is its key with a leading "-", a width is
 * "key=px". Pure, so the parsing a browser store needs is tested.
 */

export const MIN_TABLE_COLUMN_WIDTH = 64;
const MAX_TABLE_COLUMN_WIDTH = 900;

export interface ColumnLayout<K extends string> {
  order: K[];
  hidden: ReadonlySet<K>;
}

/**
 * The stored layout, or the default one when nothing is stored. Unknown keys
 * (a column a release removed) drop out; a column the stored list does not
 * name (one a release added) joins at the end, hidden if it hides by default.
 */
export function readColumnLayout<K extends string>(
  stored: readonly string[],
  columns: readonly K[],
  defaultHidden: readonly K[]
): ColumnLayout<K> {
  if (!stored.length) return { order: [...columns], hidden: new Set(defaultHidden) };
  const known = new Set<string>(columns);
  const order: K[] = [];
  const hidden = new Set<K>();
  for (const entry of stored) {
    const key = entry.startsWith("-") ? entry.slice(1) : entry;
    if (!known.has(key) || order.includes(key as K)) continue;
    order.push(key as K);
    if (entry.startsWith("-")) hidden.add(key as K);
  }
  for (const key of columns) {
    if (order.includes(key)) continue;
    order.push(key);
    if (defaultHidden.includes(key)) hidden.add(key);
  }
  return { order, hidden };
}

export function writeColumnLayout<K extends string>(layout: ColumnLayout<K>): string[] {
  return layout.order.map((key) => (layout.hidden.has(key) ? `-${key}` : key));
}

/** `key` one place earlier (-1) or later (1) among `visible`, the columns the reader can see. */
export function moveColumn<K extends string>(order: readonly K[], key: K, direction: -1 | 1, visible: readonly K[] = order): K[] {
  const at = visible.indexOf(key);
  const neighbour = at < 0 ? undefined : visible[at + direction];
  if (neighbour === undefined) return [...order];
  const next = order.filter((k) => k !== key);
  const index = next.indexOf(neighbour);
  next.splice(direction < 0 ? index : index + 1, 0, key);
  return next;
}

/** Stored widths, keeping only known columns inside the bounds. */
export function readColumnWidths(stored: readonly string[], keys: readonly string[]): Record<string, number> {
  const widths: Record<string, number> = {};
  for (const entry of stored) {
    const [key, value] = entry.split("=");
    const width = Number(value);
    if (!key || !keys.includes(key) || !Number.isFinite(width)) continue;
    if (width < MIN_TABLE_COLUMN_WIDTH || width > MAX_TABLE_COLUMN_WIDTH) continue;
    widths[key] = Math.round(width);
  }
  return widths;
}

export function writeColumnWidths(widths: Readonly<Record<string, number>>): string[] {
  return Object.entries(widths).map(([key, width]) => `${key}=${Math.round(width)}`);
}
