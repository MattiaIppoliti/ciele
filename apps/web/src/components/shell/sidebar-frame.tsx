"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { grabOffsetFor } from "@agent-hub/ui/resize-geometry";
import { haptic, playFeedback } from "@agent-hub/ui/feedback";
import { ResizeHandle, SHELL_GAP } from "@/components/ui/resizable-panel";
import { useModalFocus } from "@/components/motion/use-modal-focus";
import { SPRING_PANEL, SPRING_REFOLD, SPRING_UNFOLD } from "@/lib/ease";
import {
  DEFAULT_WIDTH, ICON_ONLY_AT, MAX_WIDTH, RAIL_WIDTH,
  isRailWidth, sidebarDragFor, sidebarReleaseFor,
} from "./sidebar-drag";

export interface SidebarContentOptions {
  collapsed: boolean;
  toggleLabel: string;
  onToggle: () => void;
}

interface SidebarFrameProps {
  mobileNavigation?: ReactNode;
  desktopClassName?: string;
  docked: boolean;
  setDocked: (docked: boolean) => void;
  width: number;
  setWidth: (width: number) => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  renderContent: (options: SidebarContentOptions) => ReactNode;
}

/**
 * Off-canvas navigation for phones and portrait tablets, where a 240px
 * permanent sidebar would leave the page barely a third of the screen.
 *
 * It is the *same* `SidebarContent`, always in its full (labelled) form, a
 * collapsed icon rail is a pointing device's affordance, and there is no
 * hover to reveal what an icon means on touch. The caller owns the open state
 * and closes it when navigating; the frame handles the backdrop and Escape.
 */
function NavDrawer({ drawerOpen: navDrawerOpen, setDrawerOpen: setNavDrawerOpen, renderContent }: SidebarFrameProps) {
  const reduceMotion = useReducedMotion();
  const drawerRef = useRef<HTMLDivElement>(null);

  useModalFocus(navDrawerOpen, drawerRef);

  useEffect(() => {
    if (!navDrawerOpen) return;
    const desktop = window.matchMedia("(min-width: 48rem)");
    const closeOnDesktop = () => {
      if (desktop.matches) setNavDrawerOpen(false);
    };
    closeOnDesktop();
    desktop.addEventListener("change", closeOnDesktop);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        setNavDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", closeOnDesktop);
    };
  }, [navDrawerOpen, setNavDrawerOpen]);

  return (
    // Leaves toward the edge it arrived from. Unmounting on `!navDrawerOpen`
    // took the drawer off screen in a single frame after a 200ms entrance, so
    // the mobile nav contradicted its own spatial story on every close.
    <AnimatePresence>
      {navDrawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <motion.button
            type="button"
            aria-label="Close navigation"
            onClick={() => setNavDrawerOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/50"
          />
          <motion.div
            ref={drawerRef}
            data-nav-drawer
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            tabIndex={-1}
            // Past its own width plus the inset, or the last 8px and the
            // shadow would still show at the edge.
            initial={reduceMotion ? { opacity: 0 } : { x: "calc(-100% - 1rem)" }}
            animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { x: "calc(-100% - 1rem)" }}
            transition={SPRING_PANEL}
            // A floating rounded panel, inset like the workspace panel it
            // covers. viewport-fit=cover: the insets grow to keep the account
            // row off the home indicator and the rows out from under a notch.
            className="bg-background absolute top-[max(0.5rem,env(safe-area-inset-top))] bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-[max(0.5rem,env(safe-area-inset-left))] flex w-[17rem] max-w-[85vw] flex-col overflow-hidden rounded-xl border shadow-strong"
          >
            {renderContent({
              collapsed: false,
              toggleLabel: "Close navigation",
              onToggle: () => setNavDrawerOpen(false),
            })}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/**
 * Vercel-style shell sidebar with the previous rail's mechanics: drag the
 * right edge to resize, below ICON_ONLY_AT it collapses to an icon rail,
 * past HIDE_AT it hides entirely. While hidden, hovering the left screen
 * edge peeks a floating panel; the top bar shows a reopen button.
 *
 * All of that is desktop behaviour (`md` and up). Below it the sidebar leaves
 * the layout entirely and navigation moves into `NavDrawer`, dragging a
 * resize handle and hovering a 6px screen edge are both mouse affordances,
 * and the space simply isn't there.
 */
export function SidebarFrame(props: SidebarFrameProps) {
  const {
    docked: sidebarDocked,
    setDocked: setSidebarDocked,
    width,
    setWidth,
    renderContent,
  } = props;
  const [peek, setPeek] = useState(false);
  const [dragging, setDragging] = useState(false);
  const reduceMotion = useReducedMotion();
  // Armed, not committed. Crossing HIDE_AT used to end the drag mid-gesture
  // and reset the width to the default, so a slip past the threshold was
  // unrecoverable *and* destroyed a width the user had chosen. Now it only
  // arms the outcome: dragging back disarms, and release decides.
  const [armedToHide, setArmedToHide] = useState(false);
  const grabOffsetRef = useRef(0);
  const widthBeforeDragRef = useRef(DEFAULT_WIDTH);
  const handleRef = useRef<HTMLElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  function startDrag(event: React.PointerEvent) {
    const handle = event.currentTarget as HTMLElement;
    const edge = handle.parentElement?.getBoundingClientRect().right ?? event.clientX;
    grabOffsetRef.current = grabOffsetFor(edge, event.clientX);
    widthBeforeDragRef.current = width;
    if (handle.setPointerCapture) {
      handle.setPointerCapture(event.pointerId);
      handleRef.current = handle;
      pointerIdRef.current = event.pointerId;
    }
    setArmedToHide(false);
    setDragging(true);
  }

  useEffect(() => {
    if (!dragging) return;
    const handle = handleRef.current;
    // Last few moves, so release velocity is a short average rather than the
    // single final delta, which is noisy enough to flip the outcome.
    const trail: { x: number; t: number }[] = [];
    const onMove = (e: PointerEvent) => {
      trail.push({ x: e.clientX, t: e.timeStamp });
      if (trail.length > 5) trail.shift();
      const next = sidebarDragFor(e.clientX, grabOffsetRef.current);
      setWidth(next.width);
      setArmedToHide(next.armedToHide);
    };
    const releaseVelocity = () => {
      if (trail.length < 2) return 0;
      const first = trail[0];
      const last = trail[trail.length - 1];
      const dt = last.t - first.t;
      return dt > 0 ? ((last.x - first.x) / dt) * 1000 : 0;
    };
    const endDrag = (e: PointerEvent) => {
      const release = sidebarReleaseFor(
        sidebarDragFor(e.clientX, grabOffsetRef.current),
        widthBeforeDragRef.current,
        releaseVelocity(),
      );
      setWidth(release.width);
      setSidebarDocked(release.docked);
      // The snap is the felt end of the drag (#817): rail <-> full, or hidden.
      // Same frame as the visual, same detent the bottom sheet uses.
      if (
        !release.docked ||
        isRailWidth(release.width) !== isRailWidth(widthBeforeDragRef.current)
      ) {
        playFeedback("tick");
        haptic("detent");
      }
      setArmedToHide(false);
      setDragging(false);
      const id = pointerIdRef.current;
      if (handle && id !== null && handle.hasPointerCapture?.(id)) {
        handle.releasePointerCapture(id);
      }
      handleRef.current = null;
      pointerIdRef.current = null;
    };
    // Capture keeps the drag alive across the main content and any iframe in
    // it (the live Preview), and gives us a pointercancel to clean up on.
    const target: EventTarget = handle ?? window;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    target.addEventListener("pointermove", onMove as EventListener);
    target.addEventListener("pointerup", endDrag as EventListener);
    target.addEventListener("pointercancel", endDrag as EventListener);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      target.removeEventListener("pointermove", onMove as EventListener);
      target.removeEventListener("pointerup", endDrag as EventListener);
      target.removeEventListener("pointercancel", endDrag as EventListener);
    };
  }, [dragging, setSidebarDocked, setWidth]);

  // Toggle = fully hide the sidebar (it leaves the layout entirely, not an
  // icon rail). The width is preserved on purpose: reopening restores the
  // exact state the sidebar had before closing, so a full sidebar reopens
  // full and one dragged down to the icon rail reopens as the rail.
  const close = () => setSidebarDocked(false);

  const collapsed = isRailWidth(width);

  return (
    <>
      {/* The docked sidebar's width is animated rather than transitioned,
          and it animates to and from zero, which is what makes closing and
          reopening read as a movement at all. It used to unmount on close and
          mount on open, so the main content jumped 240px in one frame; the
          CSS `transition-[width]` it carried only ever ran on the rail/full
          change, and 200ms of `ease-out` there was invisible anyway.

          `SPRING_UNFOLD` opens and `SPRING_REFOLD` closes: the opening is
          allowed its overshoot, because a panel arriving under its own
          momentum is the thing that makes the gesture legible, while a
          closing panel that overshot would pull the main content past the
          screen edge and back. Dragging animates nothing, or the width would
          chase the pointer a beat behind it. */}
      <AnimatePresence initial={false}>
        {sidebarDocked && (
          <motion.aside
            key="docked-sidebar"
            initial={{ width: 0 }}
            animate={{ width: collapsed ? RAIL_WIDTH : width }}
            exit={{
              width: 0,
              transition: reduceMotion ? { duration: 0 } : SPRING_REFOLD,
            }}
            transition={
              reduceMotion || dragging ? { duration: 0 } : SPRING_UNFOLD
            }
            // While armed, the panel dims toward the outcome instead of just
            // sitting there: the in-between frames should point at what
            // release will do, so "let go now and it closes" is legible
            // before it does.
            className={`${props.desktopClassName ?? ""} relative hidden h-full shrink-0 flex-col md:flex ${
              armedToHide ? "opacity-45" : "opacity-100"
            }`}
          >
            {/* The clip belongs to the content, not to the panel. The resize
                grip hangs off the panel's own edge and is wider than the edge
                it centres on, so a panel that clipped its overflow cut the
                grip in half down the border. */}
            <div className="h-full overflow-hidden">
              {/* The content keeps the width it is animating to, so it slides
                  out from behind the edge instead of reflowing every row while
                  the panel opens. */}
              <div
                className="flex h-full flex-col"
                style={{ width: collapsed ? RAIL_WIDTH : width }}
              >
                {renderContent({
                  collapsed,
                  toggleLabel: "Hide sidebar",
                  onToggle: close,
                })}
              </div>
            </div>
            <ResizeHandle
              side="right"
              gap={SHELL_GAP}
              // The workspace panel's own extent (the layout's `md:p-2`), so
              // the lit line bends round its rounded corners.
              span="inset-y-2"
              cornered="right"
              label="Resize sidebar"
              resizing={dragging}
              onPointerDown={startDrag}
              value={collapsed ? RAIL_WIDTH : width}
              minValue={RAIL_WIDTH}
              maxValue={MAX_WIDTH}
              onValueChange={(nextWidth) =>
                setWidth(
                  collapsed &&
                    nextWidth > RAIL_WIDTH &&
                    nextWidth < ICON_ONLY_AT
                    ? ICON_ONLY_AT
                    : nextWidth,
                )
              }
            />
          </motion.aside>
        )}
      </AnimatePresence>

      {!sidebarDocked && (
        <UndockedSidebar
          desktopClassName={props.desktopClassName}
          renderContent={renderContent}
          peek={peek}
          setPeek={setPeek}
          onDock={() => setSidebarDocked(true)}
        />
      )}
      {props.mobileNavigation ?? <NavDrawer {...props} />}
    </>
  );
}

/**
 * What stands in for the sidebar while it is hidden: the hover zone along the
 * screen edge, and the floating panel that zone reveals.
 *
 * A module-level component, not one declared inside `SidebarFrame`. A component
 * defined during render is a new type on every render, so React unmounts and
 * remounts its whole subtree; `setPeek` alone would have remounted this one
 * twice per hover, which is the one thing that breaks `AnimatePresence`: the
 * exit never plays, because by the time `peek` is false the presence that was
 * tracking the child is itself gone.
 */
function UndockedSidebar({
  desktopClassName,
  peek,
  setPeek,
  onDock,
  renderContent,
}: Pick<SidebarFrameProps, "renderContent" | "desktopClassName"> & {
  peek: boolean;
  setPeek: (peek: boolean) => void;
  /** Toggling from the floating panel docks it, rather than hiding it again. */
  onDock: () => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <>
      {/* Hover zone along the screen edge that reveals the floating panel. */}
      <div
        className={`${desktopClassName ?? ""} fixed inset-y-0 left-0 z-40 hidden w-1.5 md:block`}
        onMouseEnter={() => setPeek(true)}
      />
      {/* Enter and exit along the same path. This used to slide in from the
          left over 200ms and then vanish in a single frame when `peek` went
          false, which contradicts the spatial relationship the entrance had
          just established: a panel that came from the left edge should go back
          to it. AnimatePresence is what gives the unmount somewhere to go. */}
      <AnimatePresence>
        {peek && (
          <motion.div
            onMouseLeave={() => setPeek(false)}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -16 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -16 }}
            transition={SPRING_PANEL}
            // Exactly on the workspace panel's own inset and radius (the
            // layout's `md:p-2`, `rounded-xl`), so its top, left and bottom
            // edges and its corners land on the panel's: one box, not a
            // second one offset a few pixels inside the first.
            className={`${desktopClassName ?? ""} bg-background fixed top-2 bottom-2 left-2 z-50 hidden w-64 flex-col overflow-hidden rounded-xl border shadow-strong md:flex`}
          >
            {renderContent({
              collapsed: false,
              toggleLabel: "Dock sidebar",
              onToggle: () => {
                setPeek(false);
                onDock();
              },
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
