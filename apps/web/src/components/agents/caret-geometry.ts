/**
 * Where the composer's painted caret sits, given where the mirror measured it.
 *
 * The mirror lays the text out at full height, so its marker's top is in
 * content coordinates; the textarea scrolls, so the caret is drawn at that top
 * minus the scroll offset. A caret scrolled out of the box returns null rather
 * than a clamped position: pinning it to the edge would show a caret on a line
 * the Member is not editing.
 */
export function caretPlacement({
  markerLeft,
  markerTop,
  markerHeight,
  scrollTop,
  clientHeight,
}: {
  markerLeft: number;
  markerTop: number;
  markerHeight: number;
  scrollTop: number;
  clientHeight: number;
}): { x: number; y: number; height: number } | null {
  const y = markerTop - scrollTop;
  // One pixel of slack each way: sub-pixel line boxes land a hair outside.
  if (y < -1 || y + markerHeight > clientHeight + 1) return null;
  return { x: markerLeft, y, height: markerHeight };
}
