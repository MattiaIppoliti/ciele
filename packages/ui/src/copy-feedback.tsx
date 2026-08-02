"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "./cn";

const DEFAULT_RESET_DELAY = 1_500;

/**
 * Runs clipboard work and keeps a short-lived, keyed success state.
 * Keys let lists show feedback only on the button that was clicked.
 */
export function useCopyFeedback<Key>(resetDelay = DEFAULT_RESET_DELAY) {
  const [copiedKey, setCopiedKey] = useState<Key | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResetTimer = useCallback(() => {
    if (resetTimer.current !== null) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
  }, []);

  useEffect(() => clearResetTimer, [clearResetTimer]);

  const runCopy = useCallback(
    async (key: Key, action: () => Promise<unknown> | unknown) => {
      try {
        await action();
        clearResetTimer();
        setCopiedKey(key);
        resetTimer.current = setTimeout(() => {
          setCopiedKey(null);
          resetTimer.current = null;
        }, resetDelay);
        return true;
      } catch {
        return false;
      }
    },
    [clearResetTimer, resetDelay]
  );

  const copyText = useCallback(
    (key: Key, text: string) =>
      runCopy(key, () => navigator.clipboard.writeText(text)),
    [runCopy]
  );

  return {
    copiedKey,
    isCopied: (key: Key) => Object.is(copiedKey, key),
    copyText,
    runCopy,
  };
}

/** Animated Copy → success Check icon with a stable footprint. */
export function CopyFeedbackIcon({
  copied,
  className,
}: {
  copied: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-copied={copied || undefined}
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
    >
      {/* The swap to the check is instant (no transition while copied), so the
          success reads the moment of the click; only the return to the copy
          icon fades, which is why the transition class lives on the un-copied
          state alone. */}
      <Copy
        className={cn(
          "col-start-1 row-start-1 size-full",
          copied
            ? "opacity-0"
            : "opacity-100 transition-opacity duration-200 motion-reduce:transition-none"
        )}
      />
      <Check
        strokeWidth={2.75}
        className={cn(
          "col-start-1 row-start-1 size-full text-emerald-500",
          copied ? "opacity-100" : "opacity-0"
        )}
      />
    </span>
  );
}
