"use client";

import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { SPRING_CARET } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { caretPlacement } from "./caret-geometry";

/**
 * A caret painted over a textarea that glides between positions on a spring,
 * in place of the native one (the textarea hides its own with
 * `caret-transparent`).
 *
 * Position comes from a mirror: the text before the caret laid out in the same
 * box with the same `textClassName`, followed by a zero-width marker whose
 * offset is where the caret belongs. That is the same contract as the
 * composer's height mirror and highlight layer, so the three wrap identically.
 * A selection hides the caret, as the native one does.
 */
export function SmoothCaret({
  textareaRef,
  value,
  textClassName,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  textClassName: string;
}) {
  const reduce = useReducedMotion() ?? false;
  const prefixRef = useRef<HTMLSpanElement>(null);
  const markerRef = useRef<HTMLSpanElement>(null);
  const shown = useRef(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const height = useMotionValue(0);
  const opacity = useMotionValue(0);
  const springX = useSpring(x, SPRING_CARET);
  const springY = useSpring(y, SPRING_CARET);

  const update = useCallback(() => {
    const textarea = textareaRef.current;
    const prefix = prefixRef.current;
    const marker = markerRef.current;
    if (!textarea || !prefix || !marker) return;
    const hide = () => {
      shown.current = false;
      opacity.set(0);
    };
    if (
      document.activeElement !== textarea ||
      textarea.disabled ||
      textarea.selectionStart !== textarea.selectionEnd
    ) {
      hide();
      return;
    }
    prefix.textContent = textarea.value.slice(0, textarea.selectionStart);
    const place = caretPlacement({
      markerLeft: marker.offsetLeft,
      markerTop: marker.offsetTop,
      markerHeight: marker.offsetHeight,
      scrollTop: textarea.scrollTop,
      clientHeight: textarea.clientHeight,
    });
    if (!place) {
      hide();
      return;
    }
    x.set(place.x);
    y.set(place.y);
    height.set(place.height);
    // Appearing (focus, end of a selection, scrolled back into view) lands in
    // place: gliding in from wherever the caret was last would read as lag.
    if (!shown.current || reduce) {
      springX.jump(place.x);
      springY.jump(place.y);
    }
    shown.current = true;
    opacity.set(1);
  }, [height, opacity, reduce, springX, springY, textareaRef, x, y]);

  // An external edit (a transcript appended, the draft cleared on send) moves
  // the caret without a selectionchange of its own.
  useLayoutEffect(update, [update, value]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    // selectionchange fires after the browser moved the caret; the frame lets
    // layout catch up with the character that moved it.
    const onSelection = () => requestAnimationFrame(update);
    document.addEventListener("selectionchange", onSelection);
    textarea.addEventListener("focus", update);
    textarea.addEventListener("blur", update);
    textarea.addEventListener("scroll", update);
    document.fonts?.addEventListener("loadingdone", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(textarea);
    return () => {
      document.removeEventListener("selectionchange", onSelection);
      textarea.removeEventListener("focus", update);
      textarea.removeEventListener("blur", update);
      textarea.removeEventListener("scroll", update);
      document.fonts?.removeEventListener("loadingdone", update);
      observer?.disconnect();
    };
  }, [textareaRef, update]);

  return (
    <>
      <div
        aria-hidden="true"
        className={cn("pointer-events-none invisible absolute inset-0 overflow-hidden", textClassName)}
      >
        <span ref={prefixRef} />
        <span ref={markerRef}>{"​"}</span>
      </div>
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 w-0.5 rounded-full bg-foreground"
        style={{ x: springX, y: springY, height, opacity }}
      />
    </>
  );
}
