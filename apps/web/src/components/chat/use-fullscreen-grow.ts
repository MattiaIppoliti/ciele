"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * Grow a panel from where it sits to the whole viewport (and back), on the same
 * curve the embed host uses (`public/widget.js`).
 *
 * Full screen flips a panel from in-flow to `fixed inset-0`, which is a layout
 * change no CSS transition can interpolate, the panel just teleports. This runs
 * a FLIP instead: measure the rect before the flip, then animate the real
 * geometry (top/left/width/height + radius) from it, so the panel visibly takes
 * over more and more of the screen. Geometry, not `transform: scale`, because
 * scaling stretches the text and the chat's own iframe.
 *
 * While the animation runs the panel is `position: fixed`, so it is out of flow:
 * the caller must render `spacerProps` in its place, both to keep the
 * surrounding layout still and because the collapse target is measured from it.
 *
 * `prefers-reduced-motion` skips straight to the end state.
 */
const DURATION_MS = 420;
/** easeOutBack, overshoots ~8% before settling; the bounce. */
const EASE = "cubic-bezier(.34,1.42,.64,1)";

type Frame = {
  top: number;
  left: number;
  width: number;
  height: number;
  radius: string;
};

function frameOf(el: HTMLElement): Frame {
  const rect = el.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    radius: getComputedStyle(el).borderRadius,
  };
}

function keyframe(frame: Frame) {
  return {
    top: `${frame.top}px`,
    left: `${frame.left}px`,
    width: `${frame.width}px`,
    height: `${frame.height}px`,
    borderRadius: frame.radius,
  };
}

export function useFullscreenGrow() {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const [fullscreen, setFullscreenState] = useState(false);
  const [animating, setAnimating] = useState(false);
  // Captured in the toggle, before React re-renders into the other layout.
  const from = useRef<Frame | null>(null);
  const running = useRef<Animation | null>(null);

  const setFullscreen = useCallback((next: boolean) => {
    const el = surfaceRef.current;
    // No captured start frame = no FLIP: the panel simply snaps, which is also
    // what prefers-reduced-motion asks for.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    from.current = el && !reduced ? frameOf(el) : null;
    if (from.current) setAnimating(true);
    setFullscreenState(next);
  }, []);

  useLayoutEffect(() => {
    const el = surfaceRef.current;
    const start = from.current;
    from.current = null;
    if (!el || !start) return;
    const endRadius = fullscreen ? "0px" : getComputedStyle(el).borderRadius;

    running.current?.cancel();
    // Pin the panel to its starting rect before the browser paints, so the
    // first frame is where it already was rather than the new layout. This has
    // to happen BEFORE the spacer is measured: until the panel is out of flow it
    // is still a flex sibling of the spacer, and the two would split the slot.
    el.style.position = "fixed";
    el.style.margin = "0";
    el.style.zIndex = "50";
    Object.assign(el.style, keyframe(start));

    // Where the new layout puts it: the viewport when expanding, the spacer
    // holding the panel's slot when collapsing (the panel is out of flow for the
    // whole animation, so it cannot be measured in place).
    const end: Frame = fullscreen
      ? {
          top: 0,
          left: 0,
          width: window.innerWidth,
          height: window.innerHeight,
          radius: endRadius,
        }
      : spacerRef.current
        ? { ...frameOf(spacerRef.current), radius: endRadius }
        : start;

    const animation = el.animate([keyframe(start), keyframe(end)], {
      duration: DURATION_MS,
      easing: EASE,
    });
    running.current = animation;
    const settle = () => {
      if (running.current !== animation) return;
      running.current = null;
      // Hand the panel back to its classes (fixed inset-0, or in-flow).
      el.style.cssText = "";
      setAnimating(false);
    };
    animation.finished.then(settle, () => {});
  }, [fullscreen]);

  return {
    fullscreen,
    setFullscreen,
    /** Ref for the panel that grows. */
    surfaceRef,
    /** True while the FLIP runs, the panel is out of flow. */
    animating,
    /** Render in the panel's slot while `animating`, with the panel's own sizing classes. */
    spacerRef,
  };
}
