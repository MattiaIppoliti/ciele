"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { SmilePlus } from "lucide-react";
import {
  FEEDBACK_REACTIONS,
  feedbackReactionById,
  type FeedbackReactionId,
} from "@agent-hub/core";
import { cn } from "@/lib/utils";

export function EmojiFeedback({
  value,
  onChange,
  className,
}: {
  value: FeedbackReactionId | null;
  onChange: (reaction: FeedbackReactionId | null) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const selected = feedbackReactionById(value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={root} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-label={selected ? `Reaction: ${selected.label}` : "Rate response"}
        aria-haspopup="menu"
        aria-expanded={open}
        title={selected ? selected.label : "Rate response"}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          selected && "bg-muted text-foreground",
        )}
      >
        {selected ? (
          <span aria-hidden className="text-base leading-none">{selected.emoji}</span>
        ) : (
          <SmilePlus className="size-3.5" />
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Choose a reaction"
            initial={reduceMotion ? false : { opacity: 0, y: 6, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            style={{ x: "-50%" }}
            className="absolute bottom-full left-1/2 z-40 mb-2 flex items-center gap-1 rounded-full border bg-popover p-1.5 shadow-strong"
          >
            {FEEDBACK_REACTIONS.map((reaction, index) => (
              <motion.button
                key={reaction.id}
                type="button"
                role="menuitemradio"
                aria-label={reaction.label}
                aria-checked={value === reaction.id}
                title={reaction.label}
                initial={reduceMotion ? false : { opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                whileHover={{ scale: 1.1 }}
                transition={{ duration: 0.22, delay: 0.05 + index * 0.05, ease: [0.34, 1.42, 0.64, 1] }}
                onClick={() => {
                  onChange(value === reaction.id ? null : reaction.id);
                  setOpen(false);
                }}
                className={cn(
                  "grid size-8 place-items-center rounded-full text-xl leading-none transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  value === reaction.id && "bg-muted ring-1 ring-border",
                )}
              >
                {reaction.emoji}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
