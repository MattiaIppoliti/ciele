"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "@/components/theme-provider";

/* Must outlast the longest data-sky-transition animation in home.css. */
const TRANSITION_MS = 1000;

/**
 * Renders nothing. Stamps `data-sky-transition="to-night" | "to-day"` on
 * <html> for the duration of a theme toggle so home.css can play the
 * sun/moon handoff (sun sets down-left, moon rises in from the right,
 * backdrop passes through dusk) instead of the instant settled-state swap.
 * First mount is skipped: page loads paint the settled scene directly.
 */
export function SkySceneTransition() {
  const { resolvedTheme } = useTheme();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const last = previous.current;
    previous.current = resolvedTheme;
    if (last === null || last === resolvedTheme) return;

    const el = document.documentElement;
    el.setAttribute(
      "data-sky-transition",
      resolvedTheme === "dark" ? "to-night" : "to-day"
    );
    const timer = setTimeout(
      () => el.removeAttribute("data-sky-transition"),
      TRANSITION_MS
    );
    return () => {
      clearTimeout(timer);
      el.removeAttribute("data-sky-transition");
    };
  }, [resolvedTheme]);

  return null;
}
