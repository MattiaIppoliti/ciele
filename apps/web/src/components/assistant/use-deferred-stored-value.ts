"use client";

import { useEffect, useEffectEvent } from "react";

/**
 * Reads one browser-stored value after mount and hands it to `apply`.
 *
 * Deferred on a zero timer rather than read during render or in the effect
 * body itself: the server rendered the page without the browser's preference,
 * and the first client paint has to agree with that markup before anything
 * replaces it. Four preferences in the Flow Builder are restored this way (the
 * draft, the rendering, the canvas direction and the node offsets), and each
 * used to carry its own copy of the timer, the try/catch and the cleanup.
 *
 * Deliberately no run-once ref: StrictMode mounts, cleans up and mounts again,
 * and a ref guard set on the first mount would leave the second with nothing
 * scheduled and the value never read. Re-running when `key` changes is the
 * point, a new Flow or a flipped direction is a different stored value. An
 * Effect Event reads the latest `parse` and `apply` without restarting the
 * storage read for inline functions.
 *
 * A `null` key reads nothing; `apply` still receives `parse(null)` so a caller
 * that gates a writer on "the read has happened" is not left waiting. A
 * storage that throws (private mode, a blocked origin) reads as empty.
 */
export function useDeferredStoredValue<T>(
  key: string | null,
  parse: (raw: string | null) => T,
  apply: (value: T) => void
): void {
  const applyStored = useEffectEvent((raw: string | null) => apply(parse(raw)));
  useEffect(() => {
    const timer = window.setTimeout(() => {
      let raw: string | null = null;
      if (key !== null) {
        try {
          raw = window.localStorage.getItem(key);
        } catch {
          /* private mode */
        }
      }
      applyStored(raw);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [key]);
}
