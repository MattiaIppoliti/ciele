"use client";

// Icon data, not components: morphicons samples these paths and springs
// between them, so the copy mark reshapes into the check.
import { Check as CheckData, Copy as CopyData } from "lucide";
import { MorphIcon } from "morphicons/react";
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

/**
 * Copy → success Check, as one mark that reshapes.
 *
 * It used to be two stacked glyphs cross-fading, which meant the success read
 * as a different icon arriving. Morphing the paths (morphicons.com) keeps it a
 * single object changing state, and drops the stacking grid: the footprint is
 * whatever `size` says, in both states.
 */
export function CopyFeedbackIcon({
  copied,
  className,
  size = 16,
}: {
  copied: boolean;
  className?: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      data-copied={copied || undefined}
      className={cn("inline-grid shrink-0 place-items-center", className)}
    >
      <MorphIcon
        icon={copied ? CheckData : CopyData}
        size={size}
        strokeWidth={copied ? 2.75 : 2}
        className={copied ? "text-emerald-500" : undefined}
      />
    </span>
  );
}
