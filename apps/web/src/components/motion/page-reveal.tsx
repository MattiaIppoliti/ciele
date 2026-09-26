"use client";

import { type ReactNode, useLayoutEffect, useRef } from "react";
import { EASE_OUT_CSS } from "@/lib/ease";
import { REVEAL_DURATION_MS, revealDelays } from "./page-reveal-timing";

/**
 * A page's blocks arriving one after another when a route opens. Mounted from
 * a `template.tsx`, which Next.js remounts on every navigation between its
 * child segments, so the entrance replays per page and never on a re-render.
 *
 * It needs no cooperation from the page. The blocks are found by walking down
 * from the page root through single-child wrappers until an element holds
 * several children, and those are what stagger in.
 *
 * Three cases wait or stand aside instead of animating:
 * - A route skeleton (`data-slot="skeleton"`) in the first blocks means the
 *   loading boundary is showing. The entrance waits for the real content,
 *   which React swaps in within one commit, so a MutationObserver sees it
 *   before it is painted.
 * - A nested `PageReveal` (the assistant editor's sections) owns its own
 *   entrance, and animating both would multiply the fade.
 * - A page marked `data-own-entrance` (the home page) choreographs its own.
 * - Before hydration, CSS keeps the page transparent (`pending` in
 *   globals.css), so the server-rendered page does not flash in and then
 *   restart. A CSS fallback shows it anyway if the script never runs. The
 *   marketing site opts out of that (`initialLoad="skip"`), see below.
 */
export function PageReveal({
  children,
  initialLoad = "animate",
}: {
  children: ReactNode;
  /**
   * What the first page of a visit does. `"skip"` paints the server HTML at
   * once and animates only later navigations: the marketing site, where a
   * page hidden until hydration costs first paint and LCP. `"animate"` keeps
   * the page transparent until hydration so its first entrance does not flash.
   */
  initialLoad?: "animate" | "skip";
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const wrapper = ref.current;
    if (!wrapper) return;
    wrapper.dataset.pageReveal = "live";
    const initial = isInitialCommit();
    settleInitialCommit();
    // On the first page of a visit, stand aside when there is nothing to hide
    // from: this surface opted out, or hydration came so late that the CSS
    // fallback already showed the page (animating it again would flash).
    if (initial && (initialLoad === "skip" || performance.now() > FALLBACK_MS)) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const running: Animation[] = [];
    let settled = false;

    const settle = () => {
      settled = true;
      observer.disconnect();
      clearTimeout(giveUp);
    };
    const attempt = () => {
      if (settled) return;
      const plan = pickBlocks(wrapper);
      if (plan === "loading") return;
      settle();
      if (plan === "nested") return;
      const delays = revealDelays(plan.length, reduce);
      delays.forEach((delay, i) => {
        running.push(
          plan[i].animate(
            // A transform or filter makes the block the containing block of
            // any fixed or sticky descendant, which would ride along with it
            // for the length of the entrance. Those blocks only fade.
            reduce || holdsPinnedDescendant(plan[i])
              ? [{ opacity: 0 }, { opacity: 1 }]
              : [
                  { opacity: 0, transform: "translateY(12px)", filter: "blur(6px)" },
                  { opacity: 1, transform: "translateY(0)", filter: "blur(0)" },
                ],
            {
              duration: reduce ? 200 : REVEAL_DURATION_MS,
              delay,
              easing: EASE_OUT_CSS,
              // Holds the first frame through the delay, so a later block is
              // not visible, then hidden, then revealed.
              fill: "backwards",
            },
          ),
        );
      });
    };

    const observer = new MutationObserver(attempt);
    observer.observe(wrapper, { childList: true, subtree: true });
    // A page that is still loading after this long gets no entrance: it would
    // arrive long after the navigation that asked for it.
    const giveUp = setTimeout(settle, 6000);
    attempt();

    return () => {
      settle();
      for (const animation of running) animation.cancel();
    };
  }, [initialLoad]);

  return (
    <div ref={ref} data-page-reveal={initialLoad === "skip" ? "live" : "pending"} className="contents">
      {children}
    </div>
  );
}

/** Matches the `page-reveal-fallback` delay in globals.css. */
const FALLBACK_MS = 900;

let initialCommitSettled = false;

/**
 * True during the commit that hydrates the first page of a visit. Nested
 * templates hydrate in the same commit, so the flag flips on the next frame
 * rather than at the first effect, and every one of them sees the same answer.
 */
export function isInitialCommit(): boolean {
  return !initialCommitSettled;
}

function settleInitialCommit() {
  if (initialCommitSettled) return;
  requestAnimationFrame(() => {
    initialCommitSettled = true;
  });
}

function holdsPinnedDescendant(block: HTMLElement): boolean {
  return block.matches(".fixed, .sticky") || block.querySelector(".fixed, .sticky") !== null;
}

function pickBlocks(wrapper: HTMLElement): HTMLElement[] | "loading" | "nested" {
  // A nested reveal, or a page with its own choreographed entrance, owns it.
  if (wrapper.querySelector("[data-page-reveal], [data-own-entrance]")) return "nested";
  const top = descend(visibleChildren(wrapper));
  const loading = top
    .slice(0, 2)
    .some((block) => block.matches('[data-slot="skeleton"]') || block.querySelector('[data-slot="skeleton"]'));
  if (loading) return "loading";
  // A page is often a header and one big body. Arriving as two pieces reads
  // as one fade, so a block taller than 40% of the screen, or a grid of cards,
  // is split into its own children once: those are the pieces a reader sees.
  const tall = window.innerHeight * 0.4;
  return top.flatMap((block) => {
    if (block.offsetHeight < tall && getComputedStyle(block).display !== "grid") return [block];
    const inner = descend(visibleChildren(block));
    return inner.length >= 2 ? inner : [block];
  });
}

/** Walk through single-child wrappers to the first element holding several. */
function descend(blocks: HTMLElement[]): HTMLElement[] {
  for (let depth = 0; depth < 6 && blocks.length === 1; depth++) {
    const next = visibleChildren(blocks[0]);
    if (!next.length) break;
    blocks = next;
  }
  return blocks;
}

/** Children that paint in the page flow. `display: contents` is looked through. */
function visibleChildren(node: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const child of Array.from(node.children)) {
    if (!(child instanceof HTMLElement) || /^(SCRIPT|STYLE|TEMPLATE|LINK)$/.test(child.tagName)) continue;
    const style = getComputedStyle(child);
    if (style.display === "contents") out.push(...visibleChildren(child));
    else if (style.display !== "none" && style.position !== "fixed") out.push(child);
  }
  return out;
}
