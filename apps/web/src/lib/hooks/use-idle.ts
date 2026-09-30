"use client";

import { useEffect } from "react";

/**
 * Runs `callback` once the page has settled after mount: arrival's own
 * requests go first. `callback` should be stable (a module-level function).
 */
export function useIdle(callback: () => void, fallbackMs: number) {
  useEffect(() => {
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(callback, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    // Safari has no idle callback. `globalThis`, because the lib types say
    // `window` always has one and narrow it to `never` on this branch.
    const timer = globalThis.setTimeout(callback, fallbackMs);
    return () => globalThis.clearTimeout(timer);
  }, [callback, fallbackMs]);
}
