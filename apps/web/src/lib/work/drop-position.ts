/**
 * Where a dropped Task lands (#1064): a drop names the Task it fell on and
 * which edge of it, and the server takes a position as the two neighbours it
 * goes between. Pure, so the drag code only has to report what it saw.
 */

export type DropEdge = "top" | "bottom";

export interface DropPosition {
  afterId: string | null;
  beforeId: string | null;
}

/**
 * The neighbours for dropping `movingId` on `targetId`'s `edge`, within the
 * order the viewer sees (`orderedIds`, the moving Task may be in it).
 */
export function dropPosition(
  orderedIds: readonly string[],
  movingId: string,
  targetId: string | null,
  edge: DropEdge | null
): DropPosition {
  const ids = orderedIds.filter((id) => id !== movingId);
  if (!targetId || !ids.includes(targetId)) {
    // Dropped on a column or group, not on a card: it goes last.
    return { afterId: ids.at(-1) ?? null, beforeId: null };
  }
  const index = ids.indexOf(targetId);
  if (edge === "top") return { afterId: index > 0 ? ids[index - 1]! : null, beforeId: targetId };
  return { afterId: targetId, beforeId: ids[index + 1] ?? null };
}

/** Whether a drop would leave the Task exactly where it is. */
export function isNoOpDrop(orderedIds: readonly string[], movingId: string, position: DropPosition): boolean {
  const index = orderedIds.indexOf(movingId);
  if (index < 0) return false;
  const before = index > 0 ? orderedIds[index - 1]! : null;
  const after = orderedIds[index + 1] ?? null;
  return position.afterId === before && position.beforeId === after;
}

/**
 * The keyboard's drop (#1064, WCAG 2.5.7): one step up or down the order the
 * viewer sees, as the neighbours a drop there would name. Null at either end.
 */
export function stepPosition(orderedIds: readonly string[], movingId: string, direction: -1 | 1): DropPosition | null {
  const index = orderedIds.indexOf(movingId);
  const target = index < 0 ? undefined : orderedIds[index + direction];
  if (!target) return null;
  return dropPosition(orderedIds, movingId, target, direction < 0 ? "top" : "bottom");
}
