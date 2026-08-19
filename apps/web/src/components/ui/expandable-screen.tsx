"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@agent-hub/ui";

/**
 * ExpandableScreen: a trigger element that morphs into a full-screen panel.
 *
 * The trigger and the content share a `layoutId`, so Motion animates the
 * bounding box (position + size + radius) from the small trigger to the
 * full-screen panel and back. Reduced-motion users get a plain fade with no
 * layout morph.
 */

type ExpandableScreenContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  layoutId: string;
  triggerRadius: string;
  contentRadius: string;
};

const ExpandableScreenContext =
  createContext<ExpandableScreenContextValue | null>(null);

function useExpandableScreen(component: string): ExpandableScreenContextValue {
  const ctx = useContext(ExpandableScreenContext);
  if (!ctx) {
    throw new Error(`<${component}> must be rendered inside <ExpandableScreen>`);
  }
  return ctx;
}

export function ExpandableScreen({
  children,
  layoutId,
  triggerRadius = "9999px",
  contentRadius = "24px",
}: {
  children: ReactNode;
  /** Shared id used to morph the trigger into the content. Defaults to a
   *  generated id, pass an explicit one only when it needs to be stable. */
  layoutId?: string;
  /** Border radius of the collapsed trigger. */
  triggerRadius?: string;
  /** Border radius of the expanded content. */
  contentRadius?: string;
}) {
  const fallbackId = useId();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <ExpandableScreenContext.Provider
      value={{
        isOpen,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
        layoutId: layoutId ?? fallbackId,
        triggerRadius,
        contentRadius,
      }}
    >
      {children}
    </ExpandableScreenContext.Provider>
  );
}

export function ExpandableScreenTrigger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { isOpen, open, layoutId, triggerRadius } = useExpandableScreen(
    "ExpandableScreenTrigger",
  );
  const reduce = useReducedMotion();

  return (
    <motion.button
      type="button"
      onClick={open}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      // Drop the layoutId while open so the content owns the shared box.
      layoutId={reduce || isOpen ? undefined : layoutId}
      style={{ borderRadius: triggerRadius }}
      className={cn(
        "overflow-hidden outline-none",
        isOpen && "pointer-events-none opacity-0",
        className,
      )}
    >
      {children}
    </motion.button>
  );
}

export function ExpandableScreenContent({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { isOpen, close, layoutId, contentRadius } = useExpandableScreen(
    "ExpandableScreenContent",
  );
  const reduce = useReducedMotion();

  // Portal to <body> so the panel escapes `.home-scene`, that scope hides the
  // native cursor, so an inline panel would show no cursor at all (the custom
  // home cursor sits below this overlay). SSR-safe portal gate (same pattern as
  // core/morphing-dialog.tsx): renders null on the server, hydrates without a
  // setState-in-effect.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, close]);

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Backdrop fades independently of the morph. */}
      <AnimatePresence>
        {isOpen ? (
          <motion.div
            key="expandable-backdrop"
            aria-hidden="true"
            onClick={close}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
          />
        ) : null}
      </AnimatePresence>

      {/* The panel is mounted only while open. Because it carries the same
          layoutId as the trigger, Motion morphs trigger→panel on open and
          panel→trigger on close (no AnimatePresence needed for that). */}
      {isOpen ? (
        <motion.div
          role="dialog"
          aria-modal="true"
          layoutId={reduce ? undefined : layoutId}
          style={{ borderRadius: contentRadius }}
          initial={reduce ? { opacity: 0 } : false}
          animate={reduce ? { opacity: 1 } : undefined}
          transition={{ type: "spring", stiffness: 240, damping: 28 }}
          className={cn(
            "fixed inset-0 z-[101] overflow-y-auto sm:inset-6 md:inset-10",
            className,
          )}
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-4 top-4 z-10 flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <X className="size-5" />
          </button>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: reduce ? 0 : 0.12, duration: 0.3 }}
            className="min-h-full"
          >
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </>,
    document.body,
  );
}
