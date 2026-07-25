/** Returns a new priority order with source moved into target's slot. */
export function moveFlowId(
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
