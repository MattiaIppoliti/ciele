/**
 * The Flow Canvas background (surface-field) and the geometry it is fed.
 *
 * The field draws the dot-and-line fabric behind the chain and clears a band
 * round every step card. It knows nothing about React Flow: it takes a camera
 * and a list of rectangles, and this module is the translation from React
 * Flow's store to those two, kept out of the `.tsx` so vitest can reach it.
 *
 * Two coordinate spaces, and mixing them is the bug to avoid:
 * - scene rects are SCREEN space, CSS px relative to the canvas root, which is
 *   exactly the transform React Flow draws a node with;
 * - footprints (a card being carried) are VIEWPORT CSS px, the scene rect
 *   shifted by the root's own `getBoundingClientRect()`.
 */

/** React Flow's camera: `[x, y, zoom]`, drawing world `(wx, wy)` at `(wx * zoom + x, wy * zoom + y)`. */
export type CanvasTransform = readonly [x: number, y: number, zoom: number];

/** The slice of a React Flow internal node this module reads. */
export interface FieldNodeInput {
  id: string;
  hidden?: boolean;
  dragging?: boolean;
  measured: { width?: number; height?: number };
  internals: { positionAbsolute: { x: number; y: number } };
}

export interface FieldRect {
  id: string;
  parent: string | null;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Every visible, measured node as a screen-space rectangle. A node React Flow
 * has not measured yet has no box to clear, so it is skipped rather than drawn
 * as a zero-size hole at its origin. `carriedOnly` keeps just the nodes being
 * dragged, which are the footprint.
 */
export function nodeScreenRects(
  transform: CanvasTransform,
  nodes: Iterable<FieldNodeInput>,
  carriedOnly = false
): FieldRect[] {
  const [x, y, zoom] = transform;
  const rects: FieldRect[] = [];
  for (const node of nodes) {
    const { width, height } = node.measured;
    if (node.hidden || !width || !height) continue;
    if (carriedOnly && !node.dragging) continue;
    const p = node.internals.positionAbsolute;
    rects.push({
      id: node.id,
      parent: null,
      left: p.x * zoom + x,
      top: p.y * zoom + y,
      right: (p.x + width) * zoom + x,
      bottom: (p.y + height) * zoom + y,
    });
  }
  return rects;
}

/** Scene rects moved into viewport space, for `setFootprint`. */
export function toViewportRects(
  rects: readonly FieldRect[],
  root: { left: number; top: number }
): { left: number; top: number; right: number; bottom: number }[] {
  return rects.map((rect) => ({
    left: root.left + rect.left,
    top: root.top + rect.top,
    right: root.left + rect.right,
    bottom: root.top + rect.bottom,
  }));
}

/**
 * Whether two scene lists draw the same clearings. React Flow's store changes
 * for far more than geometry (selection, hover, a handle's connection state),
 * and every `setScene` is a full canvas repaint, so the bridge sends one only
 * when a box actually moved.
 */
export function sameFieldRects(a: readonly FieldRect[], b: readonly FieldRect[]): boolean {
  return (
    a.length === b.length &&
    a.every((rect, index) => {
      const other = b[index]!;
      return (
        rect.id === other.id &&
        rect.left === other.left &&
        rect.top === other.top &&
        rect.right === other.right &&
        rect.bottom === other.bottom
      );
    })
  );
}

/**
 * The field's tuning on this canvas: the package's "workspace" preset, which is
 * the one built for an editor rather than a backdrop. No tint, because the
 * console is neutral and the field should be the texture of the floor, not a
 * colour on it; no wander or breathing, because a surface Members work on for
 * minutes should move only when they do.
 */
export const FLOW_FIELD_SETTINGS = {
  gap: 22,
  focusRadius: 280,
  lineRadius: 200,
  baseOpacity: 0.02,
  maxOpacity: 0.2,
  connected: true,
  cursorPush: 2,
  ripplePush: 6,
  surfacePadding: 6,
  tint: 0,
  breathe: 0,
  wander: false,
} as const;
