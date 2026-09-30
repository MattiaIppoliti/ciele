"use client";

import type { ReactNode, RefObject } from "react";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronLeft } from "lucide-react";
import { SidebarToggleIcon } from "@/components/ui/sidebar-toggle-icon";
import { Hint } from "@agent-hub/ui";
import { cn } from "@/lib/utils";
import { SPRING_REFOLD, SPRING_UNFOLD } from "@/lib/ease";
import { RAIL_CARD_INSET, ResizeHandle } from "@/components/ui/resizable-panel";
import { useDockedRail } from "@/components/shell/right-rail";

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
/**
 * Width of the collapsed rail, where an opening drag starts from: the strip
 * and a margin beside it.
 */
const RAIL_PANEL_RAIL_WIDTH = 40;
/** The content column's horizontal padding (`pr-1`, none on the left). */
const RAIL_CONTENT_GUTTER = 4;
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
  peek,
  hideControl = true,
  startResizing = false,
  variant = "docked",
  flush = false,
  animateEntry = false,
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
   * What a collapsed panel draws. `"rail"` is `RailCollapsed`, a strip the
   * size of its chat card, for a panel whose only way back is there. `"hidden"` draws nothing,
   * for a panel reopened from a control elsewhere (the Flows Agent's own
   * header button): a second collapsed strip beside the Preview's would be
   * two reopen affordances for two panels that cannot both be open.
   */
  whenCollapsed?: "rail" | "hidden";
  /** What the collapsed strip reveals, faded, while the pointer is over it. */
  peek?: ReactNode;
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
  /**
   * Grow in from the collapsed strip on mount. For a panel the Member just
   * asked for (the launcher's first open); off for one restored on arrival,
   * which should simply be there rather than unfold on every navigation.
   */
  animateEntry?: boolean;
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

  const reduceMotion = useReducedMotion();
  // Published to the shell while it holds the rail, so the notification stack
  // lands beside the chat instead of on its composer. Nothing to move aside
  // for a collapsed rail (one button at its top) or the full-route variant.
  const { width, fade, resizing, beginResize, resizeTo, containerRef } =
    useDockedRail(
      {
        defaultWidth: RAIL_PANEL_DEFAULT_WIDTH,
        minWidth: RAIL_PANEL_MIN_WIDTH,
        maxWidth: RAIL_PANEL_MAX_WIDTH,
        initialResizing: startResizing,
        overdrag: {
          railWidth: RAIL_PANEL_RAIL_WIDTH,
          collapseThreshold: RAIL_PANEL_COLLAPSE_THRESHOLD,
          onCollapse: () => toggleCollapsed(true),
        },
      },
      !asPage && !collapsed
    );

  // Collapsed: `RailCollapsed`, the toggle alone, reopens the panel on click. Dragging the
  // handle also reopens it: the panel grows from the rail under the pointer,
  // fading in, and snaps to the minimum on release (Spotify-style). A page is
  // never collapsed: there is nothing beside it to make room for.
  const peekStrip =
    whenCollapsed === "hidden" ? null : (
      <RailCollapsed
        key="collapsed"
        peek={peek}
        label={labels.show}
        resizeLabel={labels.resize}
        onOpen={() => toggleCollapsed(false)}
        onResizeStart={(event) => {
          toggleCollapsed(false);
          // No pointer capture: the strip's handle unmounts the moment the
          // panel opens, and a capture on a removed element takes the drag
          // with it, leaving the panel stuck at the rail's width. Without a
          // target the hook follows the pointer on `window`, which outlives
          // the swap.
          beginResize(
            { clientX: event.clientX, pointerId: event.pointerId, currentTarget: null },
            RAIL_PANEL_RAIL_WIDTH
          );
        }}
      />
    );

  // Opening and closing move the width on the left sidebar's own springs:
  // `SPRING_UNFOLD` grows out of the strip with its overshoot, `SPRING_REFOLD`
  // folds back into it with a smaller one. A drag, and the snap after one,
  // follow the pointer with no animation, or the edge would lag behind it.
  const panel = (
    <motion.aside
      key="open"
      ref={containerRef}
      {...(asPage
        ? {}
        : {
            // Width only, exactly as the left sidebar moves: no fade, so the
            // toggle in the title row stays in view the whole way, and the
            // content keeps its width and slides out from behind the edge.
            initial: { width: RAIL_PANEL_RAIL_WIDTH },
            animate: { width },
            exit: {
              width: whenCollapsed === "hidden" ? 0 : RAIL_PANEL_RAIL_WIDTH,
              transition: reduceMotion ? { duration: 0 } : SPRING_REFOLD,
            },
            transition: reduceMotion || resizing ? { duration: 0 } : SPRING_UNFOLD,
          })}
      className={
        asPage
          ? "bg-content relative flex h-full min-h-0 w-full flex-col"
          : "group/rail relative hidden shrink-0 flex-col py-2 pr-2 md:flex"
      }
    >
      {!asPage && (
        <ResizeHandle
          resizing={resizing}
          onPointerDown={(event) => beginResize(event)}
          label={labels.resize}
          // Along the card the edge belongs to: the chat card under the title
          // row (the same top and bottom as the collapsed strip), or the
          // `flush` panel's own card.
          span={title && !flush ? "top-[4.5rem] bottom-6" : "inset-y-2"}
          cornered="right"
          value={width}
          minValue={RAIL_PANEL_MIN_WIDTH}
          maxValue={RAIL_PANEL_MAX_WIDTH}
          onValueChange={resizeTo}
        />
      )}
      {overlay}
      {/* Clips the content only: the resize handle overhangs the panel's left
          edge and must stay fully visible. Docked, this is the rail's card: an
          inner module of its own colour inside the workspace panel, the way
          the sidebar sits on the frame outside it. */}
      <div
        className={cn(
          "flex min-h-0 w-full flex-1 flex-col items-end overflow-hidden",
          // Only a `flush` panel keeps a card of its own: its chat draws no
          // edge and needs one. The Preview's chat card *is* the edge, so the
          // title row and its controls sit on the workspace panel itself.
          !asPage && flush && "bg-rail rounded-xl border"
        )}
      >
        {/* Content keeps its readable min width while the panel is dragged
            narrower: it slides out of view fading, instead of reflowing. As a
            page there is no drag and no min width to defend, so it fills the
            route, capped so the chat does not sprawl on a desktop. */}
        <div
          style={
            asPage
              ? undefined
              : {
                  width: Math.max(width, RAIL_PANEL_MIN_WIDTH) - RAIL_CARD_INSET,
                  opacity: fade,
                }
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
                  // No left gutter: the chat card's edge is the panel's, so
                  // the resize line runs along the card instead of through
                  // the empty space in front of it.
                  flush ? "p-1.5" : "py-4 pr-1",
                  resizing ? "" : "transition-opacity duration-200 ease-out",
                ]
          )}
        >
          {(title || actions || showHide) && (
            <div
              // `h-9` when titled: the row's height is what the chat card's
              // top, the collapsed strip's `top-[4.5rem]` and the resize
              // handle's span are all measured from, so it cannot be left to
              // whichever control in it happens to be tallest.
              className={cn(
                "flex items-center justify-between",
                title ? "box-content h-9 pb-3" : "pb-1.5"
              )}
            >
              <div className="flex min-w-0 items-center">
                {/* Only while the pointer is over the panel (or focus is on
                    the button), and it makes its own room: the slot grows from
                    nothing left of the title, pushing it over with a slight
                    overshoot, and shrinks back the same way when the pointer
                    leaves. A control that is always there competes with the
                    chat it sits above. Hiding is a docked-panel affordance:
                    the page has the sidebar to navigate away with. */}
                {showHide && (
                  // The slot's margin moves, not its width: a width stops dead
                  // at zero, so the overshoot only showed on the way in, where
                  // a margin can go past it and settle back both ways.
                  <span className="-ml-[2.375rem] flex shrink-0 pr-2.5 opacity-0 transition-[margin,opacity] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover/rail:ml-0 group-hover/rail:opacity-100 focus-within:ml-0 focus-within:opacity-100 motion-reduce:transition-none">
                    <RailToggleButton
                      label={labels.hide}
                      onClick={() => toggleCollapsed(true)}
                    />
                  </span>
                )}
                {title ? <h2 className="truncate text-lg font-semibold">{title}</h2> : <span />}
              </div>
              <div className="flex items-center gap-2">{actions}</div>
            </div>
          )}

          {banner}
          {children}
        </div>
      </div>
      {extras}
    </motion.aside>
  );

  if (asPage) return panel;
  // `wait`: the strip and the panel never share the edge. Closing, the panel
  // folds into the strip's width before the strip appears in its place;
  // opening, the strip leaves at once and the panel grows from its width.
  return (
    <AnimatePresence mode="wait" initial={animateEntry}>
      {collapsed ? peekStrip : panel}
    </AnimatePresence>
  );
}

/**
 * A collapsed right rail: a strip the size of the chat card, and nothing
 * else (the round toggle belongs to the open panel, shown on hover). Hovering
 * the strip widens it over the page and fades in `peek`, a glimpse of the
 * card's left slice; clicking opens the panel, and dragging its edge opens it
 * mid-resize.
 *
 * The strip widens over the page rather than pushing it, so a pass of the
 * pointer on the way to the scrollbar never reflows the form beside it.
 */
export function RailCollapsed({
  label,
  resizeLabel,
  onOpen,
  onResizeStart,
  onIntent,
  peek,
}: {
  label: string;
  resizeLabel: string;
  onOpen: () => void;
  onResizeStart: (event: React.PointerEvent) => void;
  /** The pointer or focus arrived: warm whatever opening will need. */
  onIntent?: () => void;
  peek?: ReactNode;
}) {
  return (
    // Sized in px like the width the panel folds to: the console's density
    // scales rems, and a mismatch shows as a jump at the handover.
    <aside
      style={{ width: RAIL_PANEL_RAIL_WIDTH }}
      className="relative hidden shrink-0 md:flex"
      onPointerEnter={onIntent}
      onFocus={onIntent}
    >
      {/* Flush with the workspace panel's right edge, which is its right
          border. The same distance from the panel's top and bottom
          (`inset-y-6`, the open card's bottom gap), so it sits centred: with
          the panel closed there is no title row for it to line up under. */}
      <div className="absolute inset-y-6 right-0 z-20 flex">
        <Hint label={label} side="left">
          <button
            type="button"
            aria-label={label}
            aria-expanded={false}
            onClick={onOpen}
            className="group/peek bg-card focus-visible:ring-ring relative h-full w-9 overflow-hidden rounded-l-xl border border-r-0 text-left transition-[width] duration-200 ease-out outline-none hover:w-14 focus-visible:w-14 focus-visible:ring-2 motion-reduce:transition-none"
          >
            {peek && (
              // Anchored at the strip's left edge, where the open panel's chat
              // card starts: the glimpse is that card's own left slice, laid
              // out at the width it opens to.
              <span
                aria-hidden
                style={{ width: RAIL_PANEL_DEFAULT_WIDTH - RAIL_CARD_INSET - RAIL_CONTENT_GUTTER }}
                className="pointer-events-none absolute inset-y-0 left-0 flex flex-col opacity-0 transition-opacity duration-200 group-hover/peek:opacity-25 group-focus-visible/peek:opacity-25 motion-reduce:transition-none"
              >
                {peek}
              </span>
            )}
            <ChevronLeft
              aria-hidden
              className="text-muted-foreground group-hover/peek:text-foreground absolute top-1/2 left-[1.125rem] size-4 -translate-x-1/2 -translate-y-1/2 transition-colors"
            />
          </button>
        </Hint>
        {/* Outside the button, on the strip's left edge: a drag starts here
            and a click on the strip itself opens. */}
        <ResizeHandle resizing={false} onPointerDown={onResizeStart} label={resizeLabel} />
      </div>
    </aside>
  );
}

/**
 * A right rail's hide toggle: the left sidebar's own toggle mirrored, an icon
 * with a hover wash, drawn only on an open rail.
 */
export function RailToggleButton({ label, onClick }: { label: string; onClick: () => void }) {
  // Mount from the collapsed panel shape, then morph into the open shape
  // as the rail enters. The collapsed strip and open header mount separately.
  const [shown, setShown] = useState(false);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), 0);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <Hint label={label} side="left">
      <button
        type="button"
        aria-label={label}
        aria-expanded
        onClick={onClick}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setHovered(true);
        }}
        onPointerLeave={() => setHovered(false)}
        // The left sidebar's own toggle, mirrored: the icon alone, with the
        // shared hover wash, not a disc of its own.
        className="press-control text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-2"
      >
        <SidebarToggleIcon isOpen={shown && !hovered} side="right" className="size-4" />
      </button>
    </Hint>
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
