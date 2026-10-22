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
import { useTableOrder } from "@/components/ui/table-preferences";
import { SPRING_REFOLD, SPRING_UNFOLD } from "@/lib/ease";

/**
 * A detail that shares space with its list (#1054), using the chat preview's
 * resize and spring: docked and resizable beside the list, full screen on a
 * narrow container or on request, non-modal while docked. Generalised from the
 * Improvements board's panel; the Task drawer is its second consumer.
 */
export function WorkspacePanel({
  open,
  onClose,
  detail,
  children,
  label,
  slot,
  headerActions,
  flush = false,
  header = true,
  widthKey,
}: {
  open: boolean;
  onClose: () => void;
  detail: ReactNode;
  children: ReactNode;
  /** What the panel is, for its dialog name and its buttons ("Improvement", "Task"). */
  label: string;
  /** `data-slot` prefix, so each consumer keeps its own hooks. */
  slot: string;
  /** Extra header buttons, left of full screen and close. */
  headerActions?: ReactNode;
  /**
   * Edge to edge: no page padding, and the panel docks as a ruled column
   * rather than a floating card, for a view that is itself full-bleed.
   */
  flush?: boolean;
  /**
   * False when the detail draws its own close (and full page) on its first
   * row, so the panel spends no row of its own on two buttons. Escape still closes.
   */
  header?: boolean;
  /**
   * Remembers the docked width per Member in this browser (#1054), under this
   * key of the table preference store. Unset, every open starts at 640px.
   */
  widthKey?: string;
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

  // The remembered width lands after hydration (browser storage), so it is
  // applied then, and written back when a drag ends.
  const [storedWidth, saveWidth] = useTableOrder(widthKey ?? "workspace-panel.unkeyed");
  const remembered = widthKey ? Number(storedWidth[0]) : NaN;
  useEffect(() => {
    if (Number.isFinite(remembered) && remembered > 0) resizeTo(remembered);
    // `resizeTo` is stable enough; re-running on it would fight a drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remembered]);
  const wasResizing = useRef(false);
  useEffect(() => {
    if (wasResizing.current && !resizing && widthKey) saveWidth([String(Math.round(width))]);
    wasResizing.current = resizing;
  }, [resizing, width, widthKey, saveWidth]);
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

  const fullScreenLabel = fullScreen ? "Exit full screen" : "Open full screen";
  return (
    <div className={flush ? "h-full min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-hidden px-4 py-4 @xl:px-6"}>
      <div
        ref={hostRef}
        data-slot={`${slot}-workspace`}
        className="relative flex h-full min-h-0"
      >
        <div
          data-slot={`${slot}-list-pane`}
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
          aria-label={open ? label : undefined}
          aria-modal={open && expanded ? true : undefined}
          inert={!open}
          aria-hidden={!open}
          data-slot={`${slot}-task-panel`}
          initial={false}
          // Width only, both ways: opening is the generous unfold, closing the
          // quicker refold, and nothing fades (DESIGN.md §2.9).
          animate={{
            width: open ? panelWidth : 0,
            marginLeft: open && !expanded && !flush ? 16 : 0,
          }}
          transition={
            reduceMotion || resizing ? { duration: 0 } : open ? SPRING_UNFOLD : SPRING_REFOLD
          }
          className={`relative flex min-h-0 shrink-0 flex-col outline-none ${open ? "" : "overflow-hidden"}`}
        >
          {open && !expanded && (
            <ResizeHandle
              resizing={resizing}
              onPointerDown={beginResize}
              label={`Resize ${label.toLowerCase()} panel`}
              value={Math.min(width, maxWidth)}
              minValue={360}
              maxValue={maxWidth}
              onValueChange={resizeTo}
              cornered="right"
            />
          )}
          <div
            data-slot={`${slot}-task-card`}
            className={
              flush
                ? "bg-content border-alpha-medium flex h-full min-h-0 w-full flex-col overflow-hidden border-l"
                : "squircle-card bg-card shadow-light flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border"
            }
          >
            {open && (
              <>
                {header && (
                  <header className="flex shrink-0 items-center justify-end gap-1 px-3 py-2">
                    {headerActions}
                    <Hint label={fullScreenLabel}>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={fullScreenLabel}
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
                        aria-label={`Close ${label} panel`}
                        onClick={() => {
                          setFullScreen(false);
                          onClose();
                        }}
                      >
                        <X className="size-5" />
                      </Button>
                    </Hint>
                  </header>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto">{detail}</div>
              </>
            )}
          </div>
        </motion.aside>
      </div>
    </div>
  );
}
