"use client";

import type { ReactNode, RefObject } from "react";
import { useState } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button, Hint } from "@agent-hub/ui";
import { cn } from "@/lib/utils";
import { ResizeHandle, useResizableWidth } from "@/components/ui/resizable-panel";
import { useRightRail } from "@/components/shell/right-rail";

/**
 * The workspace right rail's **chrome**, shared by everything that docks there
 * (#837): the resizable `<aside>`, its drag handle and overdrag-to-collapse,
 * the collapsed rail, the title row, and the content column that fades rather
 * than reflows while the panel is dragged narrower.
 *
 * It exists because the Assistant editor's live Preview and the Flows Agent are
 * the same object to a Member, a chat docked at the right edge, and they take
 * turns holding one rail. Two hand-written asides drift: one grows a collapse
 * threshold the other lacks, one reports its width to the notification stack
 * and the other does not. The `ChatHeader` next to this file has been one
 * component for exactly that reason since the widget shipped.
 *
 * What it does **not** own is the chat: the transcript, the composer and every
 * capability behind them belong to the panel inside it. That boundary is the
 * point. The Flows Agent authors Flows and the Preview does not, and the
 * published widget, which renders the same `ChatHeader` and the same
 * `ChatThread`, only ever *triggers* the Flows an Editor built here.
 */

const RAIL_PANEL_DEFAULT_WIDTH = 400;
const RAIL_PANEL_MIN_WIDTH = 320;
const RAIL_PANEL_MAX_WIDTH = 640;
/** Width of the collapsed rail (w-12), where an opening drag starts from. */
const RAIL_PANEL_RAIL_WIDTH = 48;
/** Release a drag below this width and the panel collapses back to the rail. */
const RAIL_PANEL_COLLAPSE_THRESHOLD = 180;

export function RailPanel({
  title,
  labels,
  actions,
  banner,
  overlay,
  extras,
  collapsed: collapsedProp,
  onCollapsedChange,
  whenCollapsed = "rail",
  hideControl = true,
  startResizing = false,
  variant = "docked",
  flush = false,
  children,
}: {
  /**
   * The panel's own heading, above the chat surface. Omitted where the surface
   * already names itself: the Flows Agent's `ChatHeader` says "Flows Agent" a
   * few pixels below, and printing it twice made the panel look like two
   * stacked headers. The row stays either way, it carries Hide.
   */
  title?: string;
  /** Spoken labels; every one of them names this panel, never "the panel". */
  labels: { show: string; hide: string; resize: string };
  /** Controls right of the title, left of Hide. */
  actions?: ReactNode;
  /** A note between the title row and the content (the Preview's launcher warning). */
  banner?: ReactNode;
  /** Covers the whole aside (the Preview's identity gate). */
  overlay?: ReactNode;
  /** Rendered inside the aside, outside the content column (dialogs). */
  extras?: ReactNode;
  /**
   * Collapsed state when the mount point owns it. Docked panels share the
   * workspace's single right rail, so "collapsed" means "does not hold the
   * rail" and only the mount point can know that. Omitted falls back to local
   * state.
   */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /**
   * What a collapsed panel draws. `"rail"` is the 48px strip with a « button,
   * for a panel whose only way back is that strip. `"hidden"` draws nothing,
   * for a panel reopened from a control elsewhere (the Flows Agent's own
   * header button): a second collapsed strip beside the Preview's would be
   * two reopen affordances for two panels that cannot both be open.
   */
  whenCollapsed?: "rail" | "hidden";
  /**
   * Whether the title row carries a Hide control. Off where the panel's own
   * content already closes it: the Flows Agent's chat header has a Close, and
   * two controls a few pixels apart that do the same thing is one too many.
   */
  hideControl?: boolean;
  /** Mount already mid-drag; the panel was opened by dragging the collapsed rail. */
  startResizing?: boolean;
  /**
   * `"docked"` is the resizable right-hand column, a pointer surface, hidden
   * below `md`. `"page"` is the same panel filling a route of its own, which
   * is how it is reachable on a phone: no width, no drag handle, no collapse,
   * since a page has no neighbour to take room from.
   */
  variant?: "docked" | "page";
  /**
   * Drop the panel's padding to a hairline, so what is inside is effectively
   * the rail. For content that already draws its own edge.
   */
  flush?: boolean;
  children: ReactNode;
}) {
  const asPage = variant === "page";
  const showHide = hideControl && variant !== "page";
  const [ownCollapsed, setOwnCollapsed] = useState(false);
  const collapsed = collapsedProp ?? ownCollapsed;

  function toggleCollapsed(value: boolean) {
    if (onCollapsedChange) onCollapsedChange(value);
    else setOwnCollapsed(value);
  }

  const { width, fade, resizing, beginResize, widthTransition, containerRef } =
    useResizableWidth({
      defaultWidth: RAIL_PANEL_DEFAULT_WIDTH,
      minWidth: RAIL_PANEL_MIN_WIDTH,
      maxWidth: RAIL_PANEL_MAX_WIDTH,
      initialResizing: startResizing,
      overdrag: {
        railWidth: RAIL_PANEL_RAIL_WIDTH,
        collapseThreshold: RAIL_PANEL_COLLAPSE_THRESHOLD,
        onCollapse: () => toggleCollapsed(true),
      },
    });

  // Tell the shell's viewport-fixed furniture how much of the right edge this
  // panel is holding, so the notification stack lands beside the chat instead
  // of on top of its composer. Nothing to move aside for a collapsed rail (one
  // button at its top) or for the full-route variant, which is the page.
  useRightRail(asPage || collapsed ? null : { width, animated: !resizing });

  // Collapsed: slim rail with a « button that reopens the panel. Dragging the
  // handle also reopens it: the panel grows from the rail under the pointer,
  // fading in, and snaps to the minimum on release (Spotify-style). A page is
  // never collapsed: there is nothing beside it to make room for.
  if (collapsed && !asPage) {
    if (whenCollapsed === "hidden") return null;
    return (
      <aside className="bg-background relative hidden w-12 shrink-0 flex-col items-center border-l pt-4 md:flex">
        <ResizeHandle
          resizing={resizing}
          onPointerDown={(event) => {
            toggleCollapsed(false);
            beginResize(event, RAIL_PANEL_RAIL_WIDTH);
          }}
          label={labels.resize}
        />
        <Hint label={labels.show} side="left">
          <Button
            variant="ghost"
            size="icon"
            aria-label={labels.show}
            onClick={() => toggleCollapsed(false)}
          >
            <ChevronsLeft className="size-4" />
          </Button>
        </Hint>
      </aside>
    );
  }

  return (
    <aside
      ref={containerRef}
      style={asPage ? undefined : { width }}
      className={
        asPage
          ? "bg-background relative flex h-full min-h-0 w-full flex-col"
          : `bg-background relative hidden shrink-0 flex-col border-l md:flex ${widthTransition}`
      }
    >
      {!asPage && (
        <ResizeHandle
          resizing={resizing}
          onPointerDown={(event) => beginResize(event)}
          label={labels.resize}
        />
      )}
      {overlay}
      {/* Clips the content only: the resize handle overhangs the panel's left
          edge and must stay fully visible. */}
      <div className="flex min-h-0 w-full flex-1 flex-col items-end overflow-hidden">
        {/* Content keeps its readable min width while the panel is dragged
            narrower: it slides out of view fading, instead of reflowing. As a
            page there is no drag and no min width to defend, so it fills the
            route, capped so the chat does not sprawl on a desktop. */}
        <div
          style={
            asPage ? undefined : { width: Math.max(width, RAIL_PANEL_MIN_WIDTH), opacity: fade }
          }
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            asPage
              ? "mx-auto w-full max-w-3xl px-4 py-4 sm:px-5"
              : [
                  // `flush` gives the rail to the surface inside it. A chat
                  // that *is* the panel wants no gutter of a second background
                  // showing around its own edge; the Preview keeps one,
                  // because the widget it mocks is a thing sitting on a page.
                  flush ? "p-1.5" : "px-5 py-4",
                  resizing ? "" : "transition-opacity duration-200 ease-out",
                ]
          )}
        >
          {(title || actions || showHide) && (
            <div
              className={cn(
                "flex items-center justify-between",
                title ? "pb-3" : "pb-1.5"
              )}
            >
              {title ? <h2 className="text-lg font-semibold">{title}</h2> : <span />}
              <div className="flex items-center gap-1">
                {actions}
                {/* Hiding is a docked-panel affordance: the page has the
                    sidebar to navigate away with. */}
                {showHide && (
                  <Hint label={labels.hide}>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={labels.hide}
                      onClick={() => toggleCollapsed(true)}
                    >
                      <ChevronsRight className="size-4" />
                    </Button>
                  </Hint>
                )}
              </div>
            </div>
          )}

          {banner}
          {children}
        </div>
      </div>
      {extras}
    </aside>
  );
}

/**
 * The chat surface inside a `RailPanel`, and its full-screen state.
 *
 * While the panel grows out of the flow (see `use-fullscreen-grow`) the spacer
 * holds its slot, and is what the collapse measures back down to.
 *
 * `framed` draws the rounded card the Preview wears, which is also the chat's
 * own edge: what separates a transcript from the panel holding it.
 */
export function ChatSurface({
  fullscreen,
  animating,
  spacerRef,
  surfaceRef,
  framed = true,
  children,
}: {
  fullscreen: boolean;
  animating: boolean;
  spacerRef: RefObject<HTMLDivElement | null>;
  surfaceRef: RefObject<HTMLDivElement | null>;
  framed?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      {animating && <div ref={spacerRef} className="min-h-0 flex-1" />}
      <div
        ref={surfaceRef}
        className={cn(
          "flex min-h-0 flex-col overflow-hidden",
          fullscreen ? "bg-card fixed inset-0 z-50" : "flex-1",
          !fullscreen && framed && "bg-card rounded-xl border"
        )}
      >
        {children}
      </div>
    </>
  );
}
