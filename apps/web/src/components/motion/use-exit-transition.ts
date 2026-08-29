"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Lets a surface whose mounting a *parent* owns still play an exit.
 *
 * The problem this solves: a panel rendered as `{open && <Panel />}` can animate
 * in (the element exists for the whole entrance) but never out, because the
 * moment `open` flips the element is gone. Across this app that produced 18
 * `slide-in-from-*` declarations against a single `slide-out-to-*`: surfaces
 * that announced a direction arriving and then simply vanished, contradicting
 * the spatial relationship the entrance had just taught.
 *
 * `AnimatePresence` is the better answer when the surface is already a
 * `motion.*` element. This is for the ones built from CSS keyframe utilities,
 * where converting the whole surface would be a larger change than the fix
 * deserves.
 *
 * Usage: call `beginExit()` instead of the parent's close, apply `exiting` to
 * pick the `animate-out` classes, and let the parent close on the callback.
 */
export function useExitTransition(onClosed: () => void, durationMs = 150) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<number | null>(null);
  const closedRef = useRef(onClosed);

  useEffect(() => {
    closedRef.current = onClosed;
  });

  // A surface unmounted while its exit is still running (route change, parent
  // state) must not leave a timer that fires into a dead component.
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const beginExit = useCallback(() => {
    if (timerRef.current !== null) return; // already leaving; don't restart it
    setExiting(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      closedRef.current();
    }, durationMs);
  }, [durationMs]);

  return { exiting, beginExit };
}
