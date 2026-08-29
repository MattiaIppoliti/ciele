/**
 * Returns a new order with source moved into target's slot, or the same array
 * reference when the move is a no-op. Shared by every drag-reorderable list
 * (Flow priority, quick-reply buttons).
 */
export function moveOrderedId(
  orderedIds: string[],
  sourceId: string,
  targetId: string
): string[] {
  if (sourceId === targetId) return orderedIds;
  const sourceIndex = orderedIds.indexOf(sourceId);
  const targetIndex = orderedIds.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) return orderedIds;
  const next = [...orderedIds];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

/**
 * Reorders records from the value sequence emitted by a shared sortable list.
 * Unknown values are ignored and records missing from the sequence remain at
 * the end, so a concurrent server addition cannot disappear during a drag.
 */
export function reorderItemsByIds<T extends { id: string }>(
  items: T[],
  orderedIds: string[]
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = orderedIds
    .map((id) => byId.get(id))
    .filter((item): item is T => Boolean(item));
  const included = new Set(ordered.map((item) => item.id));
  return [...ordered, ...items.filter((item) => !included.has(item.id))];
}
