"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { mutedFromStorageEvent, readMuted, writeMuted } from "./mute";
import type { Interaction } from "./policy";
import { attachFeedback, setActiveFeedbackRuntime, type FeedbackRuntime } from "./runtime";

/**
 * Mounts the feedback runtime on the document for the subtree below it.
 *
 * Mount it in a route-group layout beside that group's ThemeProvider, never in
 * the root layout: the published widget inherits only the root layout, and a
 * Visitor on an institution's site did not opt into Ciele's sound design. That
 * placement, not a flag, is what keeps the widget silent.
 */

interface FeedbackContextValue {
  muted: boolean;
  setMuted: (muted: boolean) => void;
  play: (interaction: Interaction) => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function FeedbackProvider({
  children,
  muted: controlledMuted,
  onMutedChange,
}: {
  children: ReactNode;
  /**
   * Controlled mute, for a host that keeps the preference somewhere other than
   * this origin's localStorage (the desktop app's main-process settings). When
   * given, storage is neither read nor written; `onMutedChange` receives the
   * user's flips instead.
   */
  muted?: boolean;
  onMutedChange?: (muted: boolean) => void;
}) {
  const controlled = controlledMuted !== undefined;
  // Lazy-init from storage on the client; the provider renders no
  // mute-dependent DOM, so there is no hydration mismatch.
  const [storedMuted, setMutedState] = useState<boolean>(() =>
    controlled ? false : readMuted(storage()),
  );
  const muted = controlled ? controlledMuted : storedMuted;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const runtimeRef = useRef<FeedbackRuntime | null>(null);

  useEffect(() => {
    const runtime = attachFeedback(document, { isMuted: () => mutedRef.current });
    runtimeRef.current = runtime;
    setActiveFeedbackRuntime(runtime);
    return () => {
      setActiveFeedbackRuntime(null);
      runtime.destroy();
      runtimeRef.current = null;
    };
  }, []);

  // Cross-tab sync, the same way the theme does it.
  useEffect(() => {
    if (controlled) return;
    const onStorage = (e: StorageEvent) => {
      const next = mutedFromStorageEvent(e);
      if (next !== null) setMutedState(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [controlled]);

  const setMuted = useCallback(
    (next: boolean) => {
      if (controlled) {
        onMutedChange?.(next);
        return;
      }
      setMutedState(next);
      writeMuted(storage(), next);
    },
    [controlled, onMutedChange],
  );

  const play = useCallback((interaction: Interaction) => {
    runtimeRef.current?.play(interaction);
  }, []);

  const value = useMemo(() => ({ muted, setMuted, play }), [muted, setMuted, play]);

  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
}

const FALLBACK: FeedbackContextValue = {
  muted: false,
  setMuted: () => {},
  play: () => {},
};

/**
 * Play interactions from code, read or flip mute. Safe outside a provider: the
 * widget and the auth pages get the silent fallback.
 */
export function useFeedback(): FeedbackContextValue {
  return useContext(FeedbackContext) ?? FALLBACK;
}

/**
 * Wraps a layer's `onOpenChange` so opening plays `open` and closing plays
 * `close`. For the roots of dialogs, popovers, menus and selects: one line per
 * primitive, and every layer in the product sounds the same.
 */
export function useOpenChangeFeedback<Args extends unknown[]>(
  onOpenChange: ((open: boolean, ...rest: Args) => void) | undefined,
): (open: boolean, ...rest: Args) => void {
  const { play } = useFeedback();
  return useCallback(
    (open: boolean, ...rest: Args) => {
      play(open ? "open" : "close");
      onOpenChange?.(open, ...rest);
    },
    [onOpenChange, play],
  );
}
