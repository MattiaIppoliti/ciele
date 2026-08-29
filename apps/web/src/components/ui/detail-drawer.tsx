"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
// `Minimize2` stays a plain lucide glyph: only the expanding direction is
// animated, the same split `ChatHeader` makes.
import { Minimize2, X } from "lucide-react";
import { Button, Hint } from "@agent-hub/ui";
import { AnimatedGlyph } from "@/components/ui/animated-icon";
import { Maximize2Icon } from "@/components/ui/icons/maximize-2";
import {
  ResizeHandle,
  useResizableWidth,
} from "@/components/ui/resizable-panel";

/**
 * The console's right-side detail panel: an overlay, a resizable drawer, and a
 * header offering the same screen full width.
 *
 * One component rather than one per surface, because the Improvements board's
 * panel and the Teammate's configuration are the same object, a detail view
 * opened beside the thing it belongs to, and a drawer that resizes on one page
 * and not the other reads as two different products. What each surface brings
 * is its own body and its own full-screen route.
 *
 * `Escape` closes, the overlay closes, and the scroll lives on the inner
 * container rather than the aside, so the handle poking out at -left-1.5 isn't
 * clipped.
 */
export function DetailDrawer({
  ariaLabel,
  fullScreenHref,
  fullScreen = false,
  onFullScreenChange,
  fullScreenLabel = "Open full screen",
  resizeLabel = "Resize panel",
  defaultWidth = 760,
  minWidth = 480,
  maxWidth = 1400,
  onClose,
  children,
}: {
  ariaLabel: string;
  /** Where the same screen lives full width. No href, no button. */
  fullScreenHref?: string;
  /** Keep the current drawer instance mounted while it fills the viewport. */
  fullScreen?: boolean;
  onFullScreenChange?: (fullScreen: boolean) => void;
  fullScreenLabel?: string;
  resizeLabel?: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const { width, resizing, beginResize, widthTransition, containerRef } =
    useResizableWidth({
      defaultWidth,
      minWidth,
      maxWidth,
    });
  const inlineFullScreen = Boolean(onFullScreenChange && fullScreen);
  const fullScreenButtonLabel = inlineFullScreen
    ? "Exit full screen"
    : fullScreenLabel;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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
        aria-label={ariaLabel}
        style={{ width: inlineFullScreen ? "100vw" : width }}
        className={`bg-background fixed inset-y-0 right-0 z-50 flex w-full max-w-full flex-col border-l shadow-xl ${widthTransition}`}
      >
        {!inlineFullScreen && (
          <ResizeHandle
            resizing={resizing}
            onPointerDown={(event) => beginResize(event)}
            label={resizeLabel}
          />
        )}
        <header className="flex shrink-0 items-center justify-end gap-1 px-3 py-2">
          {(fullScreenHref || onFullScreenChange) && (
            <Hint label={fullScreenButtonLabel}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={fullScreenButtonLabel}
                onClick={() => {
                  if (onFullScreenChange) {
                    onFullScreenChange(!inlineFullScreen);
                  } else if (fullScreenHref) {
                    router.push(fullScreenHref);
                  }
                }}
              >
                {inlineFullScreen ? (
                  <Minimize2 className="size-4" />
                ) : (
                  <AnimatedGlyph icon={Maximize2Icon} size={16} />
                )}
              </Button>
            </Hint>
          )}
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
