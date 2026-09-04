"use client";

import { MorphIcon } from "morphicons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "./cn";
import { playFeedback } from "./feedback/runtime";

// Icon data, not components: morphicons samples these paths and springs
// between them, so the copy mark reshapes into the check. Inlined from
// lucide's Check/Copy IconNodes (lucide-react only ships components, which
// MorphIcon cannot sample) so we don't carry the whole data package for
// two glyphs.
const CheckData = [["path", { d: "M20 6 9 17l-5-5" }]] as const;
const CopyData = [
  ["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" }],
  ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }],
] as const;

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
        // The check mark and the sound arrive together (feedback/).
        playFeedback("copy");
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
