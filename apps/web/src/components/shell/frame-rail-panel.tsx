"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@agent-hub/ui";
import { RailToggleButton } from "@/components/chat/rail-panel";
import { ResizeHandle, SHELL_GAP } from "@/components/ui/resizable-panel";
import { useDockedRail } from "@/components/shell/right-rail";
import { useTouchNavigation } from "@/components/shell/mobile-navigation";
import { SPRING_REFOLD, SPRING_UNFOLD } from "@/lib/ease";

const DEFAULT_WIDTH = 460;
const MIN_WIDTH = 360;
const MAX_WIDTH = 720;

/** The shell-edge rail shared by the Developer panel and Teammate workspace. */
export function FrameRailPanel({ title, labels, onClose, children }: {
  title: ReactNode;
  labels: { panel: string; hide: string; resize: string };
  onClose: () => void;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const touch = useTouchNavigation();
  const { width, fade, resizing, beginResize, resizeTo, containerRef } = useDockedRail(
    { defaultWidth: DEFAULT_WIDTH, minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH },
    !touch,
  );
  if (touch) return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        data-touch-rail
        showCloseButton={false}
        className="inset-0 flex h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none bg-background p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:max-w-none"
      >
        <header className="flex min-h-16 shrink-0 items-center gap-2.5 px-3">
          <RailToggleButton label={labels.hide} onClick={onClose} />
          <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium">{title}</DialogTitle>
        </header>
        <DialogDescription className="sr-only">{labels.panel}</DialogDescription>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      </DialogContent>
    </Dialog>
  );
  return (
    <motion.aside
      ref={containerRef}
      aria-label={labels.panel}
      initial={{ width: 0 }}
      animate={{ width }}
      exit={{ width: 0, transition: reduceMotion ? { duration: 0 } : SPRING_REFOLD }}
      transition={reduceMotion || resizing ? { duration: 0 } : SPRING_UNFOLD}
      className="relative hidden h-full shrink-0 flex-col md:flex"
      onKeyDown={event => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <ResizeHandle
        resizing={resizing}
        onPointerDown={event => beginResize(event)}
        label={labels.resize}
        value={width}
        minValue={MIN_WIDTH}
        maxValue={MAX_WIDTH}
        onValueChange={resizeTo}
        gap={SHELL_GAP}
        span="inset-y-2"
        cornered="left"
      />
      <div className="flex min-h-0 flex-1 flex-col items-end overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col" style={{ width: Math.max(width, MIN_WIDTH), opacity: fade }}>
          <header className="flex h-16 shrink-0 items-center gap-2.5 px-3 pt-2">
            <RailToggleButton label={labels.hide} onClick={onClose} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
          </header>
          {children}
        </div>
      </div>
    </motion.aside>
  );
}
