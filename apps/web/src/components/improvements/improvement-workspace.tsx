"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { Button, Hint } from "@agent-hub/ui";
import {
  ResizeHandle,
  useResizableWidth,
} from "@/components/ui/resizable-panel";
import { useModalFocus } from "@/components/motion/use-modal-focus";
import { SPRING_UNFOLD } from "@/lib/ease";

/** A task shares space with the list, using the chat preview's resize and spring. */
export function ImprovementWorkspace({
  open,
  onClose,
  detail,
  children,
}: {
  open: boolean;
  onClose: () => void;
  detail: ReactNode;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  const [fullScreen, setFullScreen] = useState(false);
  const reduceMotion = useReducedMotion();
  const compact = available > 0 && available < 800;
  const expanded = fullScreen || compact;
  const maxWidth = Math.max(360, available - 336);
  const { width, resizing, beginResize, resizeTo, containerRef } =
    useResizableWidth({
      defaultWidth: 640,
      minWidth: 360,
      maxWidth,
    });
  const panelWidth = expanded ? available : Math.min(width, maxWidth);
  useModalFocus(open && expanded, containerRef);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => setAvailable(host.clientWidth));
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // A docked task is non-modal: keyboard users can still reach the list.
  // Closing returns to the row that opened it, including after full screen.
  useEffect(() => {
    if (!open) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    containerRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, containerRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setFullScreen(false);
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const label = fullScreen ? "Exit full screen" : "Open full screen";
  return (
    <div className="min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-6">
      <div
        ref={hostRef}
        data-slot="improvement-workspace"
        className="relative flex h-full min-h-0"
      >
        <div
          data-slot="improvement-list-pane"
          inert={open && expanded}
          aria-hidden={open && expanded}
          className="min-h-0 min-w-0 flex-1 overflow-hidden"
        >
          {children}
        </div>
        <motion.aside
          ref={containerRef}
          tabIndex={-1}
          role={open ? "dialog" : undefined}
          aria-label={open ? "Improvement" : undefined}
          aria-modal={open && expanded ? true : undefined}
          inert={!open}
          aria-hidden={!open}
          data-slot="improvement-task-panel"
          initial={false}
          animate={{
            width: open ? panelWidth : 0,
            marginLeft: open && !expanded ? 16 : 0,
            opacity: open ? 1 : 0,
          }}
          transition={
            reduceMotion || resizing ? { duration: 0 } : SPRING_UNFOLD
          }
          className={`relative flex min-h-0 shrink-0 flex-col outline-none ${open ? "" : "overflow-hidden"}`}
        >
          {open && !expanded && (
            <ResizeHandle
              resizing={resizing}
              onPointerDown={beginResize}
              label="Resize improvement panel"
              value={Math.min(width, maxWidth)}
              minValue={360}
              maxValue={maxWidth}
              onValueChange={resizeTo}
              cornered="right"
            />
          )}
          <div
            data-slot="improvement-task-card"
            className="squircle-card bg-card shadow-light flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border"
          >
            {open && (
              <>
                <header className="flex shrink-0 items-center justify-end gap-1 px-3 py-2">
                  <Hint label={label}>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={label}
                      onClick={() => setFullScreen(!fullScreen)}
                    >
                      {fullScreen ? (
                        <Minimize2 className="size-4" />
                      ) : (
                        <Maximize2 className="size-4" />
                      )}
                    </Button>
                  </Hint>
                  <Hint label="Close">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Close Improvement panel"
                      onClick={() => {
                        setFullScreen(false);
                        onClose();
                      }}
                    >
                      <X className="size-5" />
                    </Button>
                  </Hint>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto">{detail}</div>
              </>
            )}
          </div>
        </motion.aside>
      </div>
    </div>
  );
}
