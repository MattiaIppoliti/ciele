/**
 * The geometry behind the Assignees block (`components/ui/assignees.tsx`).
 *
 * Pure, and separate from the component, because the fiddly part of that block
 * is not the markup: it is three numbers a caller hands in from a design panel
 * (`corner`, `overlap`, how many faces fit) and the clamping that keeps them
 * from drawing something broken. A component test cannot run in this app's
 * suite (`src/**\/*.test.ts`, node environment), so the arithmetic lives here
 * where it can be.
 */

/** The two ways the block packs its faces. */
export type AssigneeStack = "Row" | "Grid";

export interface AssigneeStackInput {
  /** Everybody assigned, including the ones that will fall into the `+N`. */
  count: number;
  /** 0–26px, as the block's panel offers it. */
  corner?: number;
  stack?: AssigneeStack;
  /** 0–22px, how far each face rides over the one before it. Row only. */
  overlap?: number;
  /** Faces drawn before the rest become a `+N`. */
  max?: number;
}

export interface AssigneeStackGeometry {
  /** Side of one face, in px. */
  faceSize: number;
  /** `border-radius` for a face, in px, already clamped to a circle. */
  radius: number;
  /** Negative left margin on every face but the first, in px. Row only. */
  offset: number;
  /** How many faces to draw. */
  shown: number;
  /** What the `+N` says. 0 means no badge. */
  rest: number;
  /** Side of the whole mark in Grid, in px, so it occupies one face's square. */
  boxSize: number;
}

/** The block's own defaults, the way it draws with no prop set. */
export const ASSIGNEE_DEFAULTS = { corner: 22, stack: "Row", overlap: 10, max: 5 } as const;

/** Side of one face in a Row. Grid quarters this same square. */
const ROW_FACE = 32;
/** The gap between the four faces of a Grid. */
const GRID_GAP = 2;

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}

/**
 * Resolve the block's props into pixels.
 *
 * Two clamps that are not obvious from the prop ranges:
 *
 *  - `corner` goes to 26px on the panel, but a face here is 32px, and a radius
 *    past half the side is a circle with nothing left to round. So it is capped
 *    at half the face: 22 and 26 both draw the circle in the design, and they
 *    both draw it here.
 *  - A Grid holds four faces and nothing else. Its `+N` replaces the fourth,
 *    not a fifth slot bolted on, so three faces plus a badge is the most it
 *    ever draws, and `overlap` means nothing to it.
 */
export function assigneeStackGeometry({
  count,
  corner = ASSIGNEE_DEFAULTS.corner,
  stack = ASSIGNEE_DEFAULTS.stack,
  overlap = ASSIGNEE_DEFAULTS.overlap,
  max = ASSIGNEE_DEFAULTS.max,
}: AssigneeStackInput): AssigneeStackGeometry {
  const total = Math.max(0, Math.trunc(count));
  const grid = stack === "Grid";
  const faceSize = grid ? (ROW_FACE - GRID_GAP) / 2 : ROW_FACE;
  const slots = Math.max(1, grid ? 4 : Math.trunc(max));
  // The badge takes a slot, so a stack one over its limit draws the badge
  // rather than a face: a `+1` beside four faces would be the same width as
  // the five faces it is standing in for.
  const shown = total > slots ? slots - 1 : total;

  return {
    faceSize,
    radius: Math.min(clamp(corner, 0, 26), faceSize / 2),
    offset: grid ? 0 : clamp(overlap, 0, 22),
    shown,
    rest: total - shown,
    boxSize: ROW_FACE,
  };
}
