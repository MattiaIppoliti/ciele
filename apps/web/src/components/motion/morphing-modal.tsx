"use client";
// beui.dev/components/motion/morphing-modal

import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "motion/react";
import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { EASE_OUT, SPRING_PANEL } from "@/lib/ease";
import { cn } from "@/lib/utils";

export interface MorphingModalProps {
  /** Which view is currently shown. `null` closes the modal. */
  viewId: string | null;
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

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div
      aria-hidden={!open}
      className={cn(
        "fixed inset-0 z-[80]",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
    >
      <motion.button
        type="button"
        aria-label="Close modal"
        initial={false}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: 0.2, ease: EASE_OUT }}
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-background/5 [backdrop-filter:blur(14px)_saturate(140%)] [-webkit-backdrop-filter:blur(14px)_saturate(140%)]",
          open ? "pointer-events-auto" : "pointer-events-none",
        )}
      />

      <div
        className={cn(
          "pointer-events-none absolute inset-0 flex justify-center px-4",
          placement === "bottom" ? "items-end pb-8" : "items-center",
        )}
      >
        <AnimatePresence initial={false}>
          {open ? (
            <motion.div
              key="panel"
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
              className={cn(
                "pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-3xl border border-border bg-background shadow-2xl will-change-transform",
                className,
              )}
            >
              {showClose ? (
                <button
                  type="button"
                  aria-label="Close"
                  onClick={onClose}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring absolute top-3 right-3 z-10 flex size-8 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <X className="size-4" />
                </button>
              ) : null}

              <motion.div layout="position" className="p-5">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div
                    key={viewId}
                    initial={
                      reduce
                        ? { opacity: 0 }
                        : { opacity: 0, y: 8, filter: "blur(4px)" }
                    }
                    animate={
                      reduce
                        ? {
                            opacity: 1,
                            transition: {
                              duration: 0.18,
                              ease: EASE_OUT,
                            },
                          }
                        : {
                            opacity: 1,
                            y: 0,
                            filter: "blur(0px)",
                            transition: {
                              duration: 0.24,
                              ease: EASE_OUT,
                            },
                          }
                    }
                    exit={
                      reduce
                        ? {
                            opacity: 0,
                            transition: {
                              duration: 0.14,
                              ease: EASE_OUT,
                            },
                          }
                        : {
                            opacity: 0,
                            y: -8,
                            filter: "blur(4px)",
                            transition: {
                              duration: 0.16,
                              ease: EASE_OUT,
                            },
                          }
                    }
                  >
                    {children}
                  </motion.div>
                </AnimatePresence>
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
