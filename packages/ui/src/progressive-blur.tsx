"use client";

import * as React from "react";
import { cn } from "./cn";

/**
 * Viewport-bottom progressive blur: content softens as it exits the bottom
 * edge of the screen, the way a lens loses focus at its rim.
 *
 * There is no native "gradient blur", so the ramp is faked with a stack of
 * backdrop-filter layers. Each layer blurs a little more than the one above
 * and is masked to a band one segment lower, and adjacent bands overlap by a
 * full segment so no seam shows between strengths. Six layers ≈ smooth to the
 * eye; more just costs compositing time.
 *
 * The veil is for content in transit, not for the end of the document: it
 * fades out over its own height as the scroll approaches the bottom, so the
 * footer's last lines are readable once the page can scroll no further. The
 * component finds its nearest scrollable ancestor on mount (falling back to
 * the window) and drives opacity directly on the DOM node, no re-render per
 * scroll frame.
 *
 * The wrapper is `position: fixed`, so it must not sit under a transformed /
 * filtered ancestor (that would re-anchor it to the ancestor, not the
 * viewport). Purely decorative: pointer-events pass through and it is hidden
 * from the accessibility tree.
 */
const LAYER_COUNT = 6;

export function ProgressiveBlur({
  className,
  maxBlur = 16,
  tint,
}: {
  className?: string;
  /** Blur radius (px) of the strongest, bottom-most band. */
  maxBlur?: number;
  /**
   * Optional CSS color the bottom edge fades toward (pass the surface's own
   * background token, e.g. `var(--background)`). Omitted = blur only.
   */
  tint?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // body and html always mean "the window scrolls": their scroll events
    // fire on document/window, not on the element, and an `overflow-x:
    // hidden` on either computes overflow-y to auto and would capture the
    // walk otherwise.
    let scroller: HTMLElement | null = node.parentElement;
    while (
      scroller &&
      scroller !== document.body &&
      scroller !== document.documentElement &&
      !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)
    ) {
      scroller = scroller.parentElement;
    }
    if (scroller === document.body || scroller === document.documentElement) {
      scroller = null;
    }
    const target =
      scroller ?? (document.scrollingElement as HTMLElement | null);
    if (!target) return;

    const update = () => {
      const remaining =
        target.scrollHeight - target.scrollTop - target.clientHeight;
      const fade = node.clientHeight || 1;
      node.style.opacity = String(Math.max(0, Math.min(1, remaining / fade)));
    };
    update();

    const listenTarget: EventTarget = scroller ?? window;
    listenTarget.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    // scrollHeight changes without a scroll event when content loads or
    // collapses (a short page must never sit under a permanent veil), so
    // watch the scroller's direct children for size changes too.
    const observer = new ResizeObserver(update);
    observer.observe(target);
    for (const child of Array.from(target.children)) {
      observer.observe(child);
    }
    return () => {
      listenTarget.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, []);

  const segment = 100 / (LAYER_COUNT + 1);
  return (
    <div
      ref={ref}
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-10 h-32",
        className,
      )}
      // Invisible until the mount effect measures the scroll position: a page
      // shorter than the viewport must never flash the veil.
      style={{ opacity: 0 }}
    >
      {Array.from({ length: LAYER_COUNT }, (_, i) => {
        // Halve the blur per step up the stack: …2, 4, 8, 16 for maxBlur 16.
        const blur = maxBlur / 2 ** (LAYER_COUNT - 1 - i);
        const stop = (n: number) => `${Math.min(n * segment, 100)}%`;
        // The bottom-most band must hold full strength through the edge: a
        // clamped trailing stop would fade it out at exactly 100%.
        const tail =
          (i + 2) * segment >= 100 ? "" : `, transparent ${stop(i + 3)}`;
        const mask = `linear-gradient(to bottom, transparent ${stop(i)}, black ${stop(i + 1)}, black ${stop(i + 2)}${tail})`;
        return (
          <div
            key={i}
            className="absolute inset-0"
            style={{
              backdropFilter: `blur(${blur}px)`,
              WebkitBackdropFilter: `blur(${blur}px)`,
              maskImage: mask,
              WebkitMaskImage: mask,
            }}
          />
        );
      })}
      {tint && (
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to bottom, transparent, color-mix(in oklab, ${tint} 85%, transparent))`,
          }}
        />
      )}
    </div>
  );
}
