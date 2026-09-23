/**
 * Row selection for the console's tables: the arithmetic behind the header
 * checkbox and the bulk bar.
 *
 * It is pure, and separate from the components, for the reason everything
 * else in `lib/` is: vitest never picks up a `.tsx`, so logic that can be
 * wrong lives where a test can reach it.
 *
 * The one rule worth knowing: **selection is scoped to the rows on screen**.
 * Every function takes the current `rowIds` and intersects against them, so a
 * page change, a filter or a search narrows the selection instead of carrying
 * invisible rows into a bulk delete. Ids left in the set are inert, not
 * pending.
 */

/** What the header checkbox draws: empty, a dash, or a tick. */
export type SelectAllState = "none" | "some" | "all";

export function selectAllState(
  selected: ReadonlySet<string>,
  rowIds: readonly string[]
): SelectAllState {
  if (rowIds.length === 0) return "none";
  let hits = 0;
  for (const id of rowIds) if (selected.has(id)) hits += 1;
  if (hits === 0) return "none";
  return hits === rowIds.length ? "all" : "some";
}

/** The selected rows, in the table's own order. What a bulk action acts on. */
export function selectedRowIds(
  selected: ReadonlySet<string>,
  rowIds: readonly string[]
): string[] {
  return rowIds.filter((id) => selected.has(id));
}

export function toggleRow(
  selected: ReadonlySet<string>,
  id: string
): Set<string> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * What a right-click on a row does to the selection.
 *
 * The menu acts on a row, so that row has to be the selected one, or the
 * reader picks "Delete" off a menu titled with one name while the bulk bar
 * above still says three are ticked. Every desktop file manager settles this
 * the same way and so does this: a right-click on a row **outside** the
 * selection replaces it, and a right-click on a row **inside** it leaves the
 * selection alone, because that is the gesture for acting on all of them.
 *
 * Returns the set it was given when nothing changes, so the caller's
 * `setState` bails instead of re-rendering the table on every right-click.
 */
export function selectForContextMenu(
  selected: ReadonlySet<string>,
  id: string
): ReadonlySet<string> {
  return selected.has(id) ? selected : new Set([id]);
}

/**
 * The header checkbox. A partial selection fills up rather than clearing:
 * three of twenty ticked and a click on the header means "all of them", which
 * is the only reading that gets anyone anywhere.
 */
export function toggleAllRows(
  selected: ReadonlySet<string>,
  rowIds: readonly string[]
): Set<string> {
  const next = new Set(selected);
  if (selectAllState(selected, rowIds) === "all") {
    for (const id of rowIds) next.delete(id);
  } else {
    for (const id of rowIds) next.add(id);
  }
  return next;
}
