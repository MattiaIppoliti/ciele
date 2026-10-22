"use client";

import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { DOCK_GLIDE } from "@/lib/ease";

/**
 * Carries an element from where it stood to where a layout change put it: a
 * FLIP on its top edge, played by the browser (Web Animations) rather than a
 * frame loop. `docked` is the change that moves it, an empty chat getting its
 * first message or a new chat emptying it again.
 *
 * The starting point is the last top this element had at rest. It is re-read
 * whenever the element or the window resizes, so a draft that grew the box in
 * the meantime does not start the glide from a stale place, and never while a
 * glide is playing, whose rect is mid-flight rather than at rest.
 */
export function useDockGlide(
  ref: RefObject<HTMLElement | null>,
  docked: boolean,
  reduced: boolean
) {
  const lastTop = useRef<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const record = () => {
      if (element.getAnimations().length === 0) {
        lastTop.current = element.getBoundingClientRect().top;
      }
    };
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(record);
    observer?.observe(element);
    window.addEventListener("resize", record);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", record);
    };
  }, [ref]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const top = element.getBoundingClientRect().top;
    const from = lastTop.current;
    lastTop.current = top;
    if (from === null || Math.abs(from - top) < 1 || reduced) return;
    element.animate(
      [{ translate: `0 ${from - top}px` }, { translate: "0 0" }],
      DOCK_GLIDE
    );
  }, [docked, reduced, ref]);
}
