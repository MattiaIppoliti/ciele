"use client";
// beui.dev/components/motion/morphing-modal

import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "motion/react";
import { X } from "lucide-react";
import { type ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "@agent-hub/ui";
import { EASE_OUT, SPRING_PANEL } from "@/lib/ease";
import { cn } from "@/lib/utils";

export interface MorphingModalProps {
  /** Which view is currently shown. `null` closes the modal. */
  viewId: string | null;
  /** Accessible name for the modal, updated as its step changes. */
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** "bottom" anchors to the viewport bottom (mobile-like). "center" centers vertically. */
  placement?: "bottom" | "center";
  /** Show the top-right close (X) button. Defaults to true. */
  showClose?: boolean;
  className?: string;
}

export function MorphingModal({
  viewId,
  title,
  onClose,
  children,
  placement = "bottom",
  showClose = true,
  className,
}: MorphingModalProps) {
  const open = viewId !== null;
  const reduce = useReducedMotion();
  const enterY = reduce ? 0 : placement === "bottom" ? 40 : 20;
  const enterScale = reduce ? 1 : 0.97;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/50 backdrop-blur-[1px] supports-backdrop-filter:bg-black/35"
        className={cn(
          "z-[80] flex max-h-[calc(100dvh-4rem)] w-[calc(100%-2rem)] max-w-sm flex-col overflow-y-auto rounded-3xl border border-border bg-background p-5 text-foreground shadow-2xl outline-none",
          placement === "bottom"
            ? "top-auto bottom-8 translate-y-0"
            : "top-1/2 -translate-y-1/2",
          "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:data-open:animate-none motion-reduce:data-closed:animate-none",
          className,
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {showClose ? (
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring absolute top-3 right-3 z-10 flex size-8 max-lg:size-11 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <X className="size-4" />
          </button>
        ) : null}
        <AnimatePresence mode="popLayout" initial={false}>
          {open ? (
            <motion.div
              key={viewId}
              layout
              initial={{ opacity: 0, y: enterY, scale: enterScale }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{
                opacity: 0,
                y: enterY,
                scale: reduce ? 1 : 0.98,
                transition: { duration: 0.18, ease: EASE_OUT },
              }}
              transition={SPRING_PANEL}
              className="will-change-transform"
            >
              {children}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
