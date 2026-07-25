"use client";

import {
  createContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";

/* Activation seam for the home page's ambient animation. One place decides
   whether an idle loop (the hero mock's view cycling, the below-fold feature
   visuals) should be running: it should run only while its island is on
   screen AND the Visitor hasn't asked for reduced motion. Off-screen islands
   — including the CSS-hidden mock instance the hero mounts for the other
   breakpoint — never intersect the viewport, so they stay inert for free. */

/** Pure activation policy — extracted so the rule is node-testable. */
export function shouldAnimate({
  visible,
  reducedMotion,
}: {
  visible: boolean;
  reducedMotion: boolean;
}): boolean {
  return visible && !reducedMotion;
}

/** True while `ref`'s element intersects the viewport. Starts false and
 * flips on the observer's first callback; falls back to true where
 * IntersectionObserver is unavailable (SSR / very old engines). A
 * `display:none` element never intersects, so a hidden instance reports
 * false and its caller's loop stays paused. */
function useInViewport<T extends Element>(
  ref: RefObject<T | null>,
  { rootMargin = "0px" }: { rootMargin?: string } = {},
): boolean {
  // Where IntersectionObserver is unavailable (SSR / old engines) default to
  // visible so the loop still runs; otherwise start false and let the
  // observer's callback flip it.
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin]);

  return visible;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** True while the Visitor's OS reduced-motion setting is on, tracked live.
 * Uses useSyncExternalStore so the snapshot is read (never set-in-effect)
 * and SSR defaults to motion-allowed. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(REDUCED_MOTION_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/** Composed convenience: should the island at `ref` run its idle animation
 * right now? (On screen and reduced-motion off.) */
export function useShouldAnimate<T extends Element>(
  ref: RefObject<T | null>,
  options?: { rootMargin?: string },
): boolean {
  const visible = useInViewport(ref, options);
  const reducedMotion = usePrefersReducedMotion();
  return shouldAnimate({ visible, reducedMotion });
}

/** True once `ref`'s element has entered the viewport at least once, then
 * stays true. For deferring below-fold work until it's about to be seen
 * (mount once, keep mounted so there's no reload/flash on scroll-away). */
export function useOnceInViewport<T extends Element>(
  ref: RefObject<T | null>,
  { rootMargin = "0px" }: { rootMargin?: string } = {},
): boolean {
  // Must be a hydration-stable constant: this value gates whether the real
  // (ssr:false) content or a placeholder renders, so server and client have
  // to agree on the first render. Start false everywhere; the client-only
  // effect below flips it once the element is near view.
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // No IntersectionObserver (very old engine): reveal rather than hide
      // forever. Runs once, client-only — not a cascading-render concern.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setSeen(true);
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin, seen]);

  return seen;
}

/* Ambient islands (the hero mock, the below-fold feature-card visuals) run
   idle animations inside 3D-/tilt-transformed subtrees, where
   IntersectionObserver can't be trusted to report the transformed element's
   own visibility. So an ancestor observes a NON-transformed element and
   passes the "should this island animate?" decision down through this
   context; the island consumes it rather than observing itself. Null = no
   provider (treat as always active). */
export const AmbientActiveContext = createContext<boolean | null>(null);
