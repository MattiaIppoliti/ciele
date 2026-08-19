"use client";

import { PlusIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type SVGProps, useCallback, useEffect, useRef, useState } from "react";
import { Cursor } from "@/components/core/cursor";

type CursorMode = "default" | "card" | "clickable";

const CLICKABLE_SELECTOR =
  'a, button, [role="button"], input, select, textarea, label, summary, [data-clickable]';

// Elements that morph the cursor into the "More +" pill: the feature cards and
// any element opted in with `data-cursor-more` (e.g. the Download CTA).
const MORE_SELECTOR = "[data-feature-card], [data-cursor-more]";

/** Arrow pointer shown over clickable elements, black fill with a white
 * outline (macOS-style), so it stays visible on both light and dark surfaces. */
function ArrowCursor(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={26}
      height={31}
      fill="none"
      {...props}
    >
      <g clipPath="url(#home-cursor-arrow)">
        <path
          fill="#000"
          stroke="#fff"
          strokeLinecap="square"
          strokeWidth={2}
          fillRule="evenodd"
          d="M21.993 14.425 2.549 2.935l4.444 23.108 4.653-10.002z"
          clipRule="evenodd"
        />
      </g>
      <defs>
        <clipPath id="home-cursor-arrow">
          <path fill="#fff" d="M0 0h26v31H0z" />
        </clipPath>
      </defs>
    </svg>
  );
}

/**
 * Custom home-page cursor with three states, driven by what's under the
 * pointer:
 *  - over a feature card (`[data-feature-card]`) → a "More +" pill;
 *  - over any clickable (buttons, links, inputs…) → a black arrow pointer;
 *  - anywhere else → a small dot.
 * Attaches to `.home-scene`; a global rule hides the native cursor across the
 * whole scene so only this cursor shows.
 */
export function HomeCursor() {
  const [mode, setMode] = useState<CursorMode>("default");
  // Show the custom cursor only while the pointer is genuinely over the home
  // scene (not over a portaled dialog, and not off-window). Controlled here so
  // it can't get stuck hidden, see the `visible` prop on <Cursor>.
  const [visible, setVisible] = useState(false);
  // Only a real mouse/trackpad drives this cursor. Touch devices (phones,
  // iPads) report a coarse pointer with no hover, there we render nothing and
  // leave the native (absent) cursor alone, so no dot follows taps around.
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine) and (hover: hover)");
    const update = () => setEnabled(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Hide the OS cursor across the entire home scene while the custom cursor is
  // active, only on fine-pointer devices, never on touch.
  useEffect(() => {
    if (!enabled) return;
    const scene = document.querySelector(".home-scene");
    scene?.classList.add("home-cursor-hide-native");
    return () => scene?.classList.remove("home-cursor-hide-native");
  }, [enabled]);

  // The pointer's latest coordinates, hit-tested at most once per animation
  // frame. `document.elementFromPoint` forces a synchronous hit-test (layout
  // read); running it on every `mousemove` (100+/sec) janks the whole page, so
  // we coalesce to one read per frame via rAF.
  const latest = useRef({ x: 0, y: 0 });
  const frame = useRef<number | null>(null);

  const evaluate = useCallback(() => {
    frame.current = null;
    const { x, y } = latest.current;
    const el = document.elementFromPoint(x, y) as HTMLElement | null;

    // Off-window, or over a portaled overlay (dialog/backdrop escape
    // `.home-scene`): let the native cursor take over and hide ours.
    if (!el || !el.closest(".home-scene")) {
      setVisible(false);
      return;
    }

    setVisible(true);
    let next: CursorMode = "default";
    if (el.closest(MORE_SELECTOR)) next = "card";
    else if (el.closest(CLICKABLE_SELECTOR)) next = "clickable";
    setMode((prev) => (prev === next ? prev : next));
  }, []);

  const handlePositionChange = useCallback(
    (x: number, y: number) => {
      latest.current = { x, y };
      if (frame.current === null) {
        frame.current = requestAnimationFrame(evaluate);
      }
    },
    [evaluate]
  );

  // Cancel a pending frame on unmount, and hide the cursor when the pointer
  // leaves the window entirely (no more `mousemove` fires to re-evaluate).
  useEffect(() => {
    if (!enabled) return;
    const onDocLeave = () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      setVisible(false);
    };
    document.addEventListener("mouseleave", onDocLeave);
    return () => {
      document.removeEventListener("mouseleave", onDocLeave);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    // Snappy, critically-damped spring, near-1:1 with the real pointer and a
    // hair of smoothing, no float/lag.
    <Cursor
      attachToParent
      visible={visible}
      variants={{
        initial: { scale: 0.3, opacity: 0 },
        animate: { scale: 1, opacity: 1 },
        exit: { scale: 0.3, opacity: 0 },
      }}
      springConfig={{ stiffness: 1500, damping: 45, mass: 0.22 }}
      transition={{ ease: "easeInOut", duration: 0.15 }}
      onPositionChange={handlePositionChange}
    >
      {mode === "clickable" ? (
        // Nudge so the arrow tip (near the SVG's top-left) sits at the pointer
        // rather than the icon's center.
        <span className="block translate-x-[7px] translate-y-[3px]">
          <ArrowCursor className="h-6 w-6" />
        </span>
      ) : (
        <motion.div
          animate={{
            width: mode === "card" ? 80 : 16,
            height: mode === "card" ? 32 : 16,
          }}
          className="flex items-center justify-center rounded-[24px] bg-gray-500/40 backdrop-blur-md dark:bg-gray-300/40"
        >
          <AnimatePresence>
            {mode === "card" ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                className="inline-flex w-full items-center justify-center"
              >
                <div className="inline-flex items-center text-sm text-white dark:text-black">
                  More <PlusIcon className="ml-1 h-4 w-4" />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
      )}
    </Cursor>
  );
}
