"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
// `Minimize2` stays a plain lucide glyph: only the expanding direction is
// animated, the same split `ChatHeader` makes.
import { X } from "lucide-react";
import { Minimize2 } from "lucide-react";
import { Button, Hint } from "@agent-hub/ui";
import { AnimatedGlyph } from "@/components/ui/animated-icon";
import { Maximize2Icon } from "@/components/ui/icons/maximize-2";
import { useModalFocus } from "@/components/motion/use-modal-focus";
import {
  ResizeHandle,
  useResizableWidth,
} from "@/components/ui/resizable-panel";

/**
 * The console's right-side detail panel: an overlay, a resizable drawer, and a
 * header button that grows the same drawer instance to the full viewport.
 *
 * `Escape` closes, the overlay closes, and the scroll lives on the inner
 * container rather than the aside, so the handle poking out at -left-1.5 isn't
 * clipped.
 */
export function DetailDrawer({
  ariaLabel,
  fullScreen,
  onFullScreenChange,
  resizeLabel,
  onClose,
  children,
}: {
  ariaLabel: string;
  /** Keep the current drawer instance mounted while it fills the viewport. */
  fullScreen: boolean;
  onFullScreenChange: (fullScreen: boolean) => void;
  resizeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const minWidth = 480;
  const maxWidth = 1400;
  const { width, resizing, beginResize, resizeTo, widthTransition, containerRef } =
    useResizableWidth({
      defaultWidth: 760,
      minWidth,
      maxWidth,
    });
  const fullScreenButtonLabel = fullScreen
    ? "Exit full screen"
    : "Open full screen";

  useModalFocus(true, containerRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
        aria-hidden
      />
      <aside
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        style={{ width: fullScreen ? "100vw" : width }}
        className={`bg-background fixed inset-y-0 right-0 z-50 flex w-full max-w-full flex-col border-l shadow-strong ${widthTransition}`}
      >
        {!fullScreen && (
          <ResizeHandle
            resizing={resizing}
            onPointerDown={(event) => beginResize(event)}
            label={resizeLabel}
            value={width}
            minValue={minWidth}
            maxValue={maxWidth}
            onValueChange={resizeTo}
          />
        )}
        <header className="flex shrink-0 items-center justify-end gap-1 px-3 py-2">
          <Hint label={fullScreenButtonLabel}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={fullScreenButtonLabel}
              onClick={() => onFullScreenChange(!fullScreen)}
            >
              {fullScreen ? (
                <Minimize2 className="size-4" />
              ) : (
                <AnimatedGlyph icon={Maximize2Icon} size={16} />
              )}
            </Button>
          </Hint>
          <Hint label="Close">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Close ${ariaLabel} panel`}
              onClick={onClose}
            >
              <X className="size-5" />
            </Button>
          </Hint>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
    </>
  );
}
