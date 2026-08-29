"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The "Copied" flash every copy button in the agent components shares:
 * `markCopied()` turns `copied` on and resets it 1600ms later, restarting
 * the timer on repeat clicks and clearing it on unmount.
 */
export function useCopied(timeoutMs = 1600): [boolean, () => void] {
  const timer = useRef<number | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const markCopied = useCallback(() => {
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), timeoutMs);
  }, [timeoutMs]);

  return [copied, markCopied];
}
