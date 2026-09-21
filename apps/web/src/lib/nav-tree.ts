/**
 * The elbow connector drawn beside a nested nav group (`shell/nav-tree.tsx`).
 *
 * One SVG path for the whole tree rather than a border-left plus a border-top
 * per row, for the reason the shape itself gives away: a corner built from two
 * 1px borders meeting at a right angle is a right angle, and a corner built
 * from a quadratic is a curve. The second one is what a tree connector looks
 * like, and it cannot be had from box borders at all.
 *
 * **One path, not one per branch.** Every elbow is a subpath of a single `d`,
 * because a translucent stroke that crosses itself blends with itself: two
 * overlapping paths at the trunk leave a visible darker dot at each junction,
 * which is exactly where the eye is already looking. One path with one stroke
 * paints each pixel once.
 *
 * Pure and separate from the component because this app's suite is `.test.ts`
 * in node (vitest ignores `.tsx`), and a connector that is one pixel off its
 * rows is the whole failure mode.
 */

/**
 * Row pitch, px. The sidebar's rows are `h-8` in a `gap-0.5` column, so 34 is
 * not a number chosen here: it is what the rest of the nav already measures,
 * and the tree rows are drawn at the same pitch so the two columns line up.
 */
export const NAV_TREE_PITCH = 34;

/** The trunk's own x. Half a pixel, so a 1px stroke lands on the pixel grid. */
const TRUNK_X = 0.5;
/** How far above a row's middle the trunk starts bending toward it. */
const ELBOW_RADIUS = 8;
/** Where a branch stops, just short of the row's icon. */
const BRANCH_END_X = 14;

export interface NavTreeGeometry {
  /** Box the caller sizes the `<svg>` with. */
  width: number;
  height: number;
  /** The whole tree: trunk plus an elbow into every row. */
  trunk: string;
  /** Trunk down to the active row and its elbow, drawn over the tree. Null
   * when nothing in the group is active, which is a normal state, not an
   * error: the group is still a group when you are somewhere else. */
  branch: string | null;
}

export function navTreeGeometry({
  count,
  activeIndex,
  pitch = NAV_TREE_PITCH,
}: {
  count: number;
  /** -1, or anything out of range, means no row is active. */
  activeIndex: number;
  pitch?: number;
}): NavTreeGeometry {
  const rows = Math.max(0, Math.trunc(count));
  const middle = (i: number) => i * pitch + pitch / 2;
  const bend = (i: number) => middle(i) - ELBOW_RADIUS;
  /* the bend itself, shared: an elbow is this with a hop to its own start,
     and the active branch is this with the trunk in front of it */
  const curve = (i: number) =>
    `Q ${TRUNK_X} ${middle(i)} ${TRUNK_X + ELBOW_RADIUS} ${middle(i)} L ${BRANCH_END_X} ${middle(i)}`;
  const elbow = (i: number) => `M ${TRUNK_X} ${bend(i)} ${curve(i)}`;

  if (rows === 0) {
    return { width: BRANCH_END_X, height: 0, trunk: "", branch: null };
  }

  const active =
    Number.isInteger(activeIndex) && activeIndex >= 0 && activeIndex < rows
      ? activeIndex
      : null;

  return {
    width: BRANCH_END_X,
    height: rows * pitch,
    // The trunk stops at the LAST row's bend, not at the bottom of the box: a
    // trunk that runs past the last elbow is a line pointing at nothing.
    trunk: [
      `M ${TRUNK_X} 0 L ${TRUNK_X} ${bend(rows - 1)}`,
      ...Array.from({ length: rows }, (_, i) => elbow(i)),
    ].join(" "),
    branch:
      active === null
        ? null
        : `M ${TRUNK_X} 0 L ${TRUNK_X} ${bend(active)} ${curve(active)}`,
  };
}
