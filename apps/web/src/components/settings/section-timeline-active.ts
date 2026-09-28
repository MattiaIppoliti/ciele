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
  /** The box's whole scroll travel, null exactly when `remaining` is. */
  travel: number | null;
}

/**
 * Which section the rail should emphasize: the last one whose top has crossed
 * the activation line, and the first one at the top of the page.
 *
 * The line **drops toward the bottom of the box over the final stretch**. A
 * fixed line at 30% of the viewport is unreachable for whatever sits in the
 * last 70% of the last screenful: the page runs out of scroll before those
 * tops get there, so the closing sections stayed grey no matter how far down
 * you read.
 *
 * The stretch is the last `bottom - line` pixels of travel, or the whole travel
 * when the page scrolls less than that. On a long page the line then moves one
 * pixel per pixel scrolled, which keeps each crossing monotonic. On a short
 * one (Guardrails, Publish) it moves faster but still starts at the fixed
 * line: the earlier `bottom - remaining` put it most of the way down before
 * any scroll, and the third section lit on arrival.
 */
export function activeSectionId(
  sections: readonly SectionTop[],
  view: TimelineView
): string | null {
  if (sections.length === 0) return null;
  let line = view.line;
  if (view.remaining !== null && view.travel !== null && view.travel > 0) {
    const scrolled = view.travel - view.remaining;
    // At the top, the page is being read from its first section.
    if (scrolled <= 1) return sections[0].id;
    const drop = Math.max(0, view.bottom - view.line);
    const stretch = Math.min(drop, view.travel);
    const into = scrolled - (view.travel - stretch);
    if (stretch > 0 && into > 0) line += drop * Math.min(1, into / stretch);
  }
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
