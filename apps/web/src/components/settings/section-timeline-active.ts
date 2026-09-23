/** One registered section, by the top edge of its box in viewport coordinates. */
export interface SectionTop {
  id: string;
  top: number;
}

/** Where the reading position sits, and how much scrolling is left under it. */
export interface TimelineView {
  /** The fixed activation line, in viewport coordinates. */
  line: number;
  /** The scrolling box's bottom edge, in the same coordinates. */
  bottom: number;
  /**
   * Distance still scrollable, or null when the box does not scroll at all.
   * Null keeps the line where it is: on a page that fits, no section has a
   * reading position to claim and the first one stays lit, as before.
   */
  remaining: number | null;
}

/**
 * Which section the rail should emphasize: the last one whose top has crossed
 * the activation line.
 *
 * The line **drops toward the bottom of the box over the final stretch**, and
 * that is the whole point of this module. A fixed line at 30% of the viewport
 * is unreachable for whatever sits in the last 70% of the last screenful: the
 * page runs out of scroll before those tops get there, so the closing sections
 * stayed grey no matter how far down you read, which is what the Tools page
 * looked like from the Data heading onwards.
 *
 * Making the line `bottom - remaining` once that is lower than the fixed one
 * keeps the crossing monotonic: a scroll of d pixels moves a section's top up
 * by d and the line down by d, so each section crosses exactly once and lights
 * in order rather than snapping at the last pixel of travel.
 */
export function activeSectionId(
  sections: readonly SectionTop[],
  view: TimelineView
): string | null {
  if (sections.length === 0) return null;
  const line =
    view.remaining === null
      ? view.line
      : Math.max(view.line, view.bottom - view.remaining);
  let active = sections[0].id;
  for (const section of sections) {
    if (section.top <= line) active = section.id;
  }
  return active;
}

/**
 * The scrolling ancestor the rail lives in, or null when the window scrolls it.
 *
 * The admin shell scrolls a nested `overflow-y-auto` column rather than the
 * document, and the rail cannot be told which one: it is rendered inside four
 * different section pages.
 */
export function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY !== "auto" && overflowY !== "scroll") continue;
    if (el.scrollHeight > el.clientHeight) return el;
  }
  return null;
}
