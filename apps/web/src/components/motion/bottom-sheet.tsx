"use client";
// Source: https://beui.dev/components/motion/bottom-sheet (MIT)

import {
  AnimatePresence,
  motion,
  type PanInfo,
  useDragControls,
  useReducedMotion,
} from "motion/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { EASE_DRAWER, SPRING_THROW } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { sheetReleaseFor } from "./projection";
import { haptic } from "@/lib/haptics";

// Vaul-style glide for the *arrival*: a long, fully-damped tween reads smoother
// than a spring on open, no settle/overshoot, just one clean decel. Same curve
// drives the backdrop fade so the surface and scrim move as one.
//
// This is deliberately NOT what a gesture release uses. Nothing threw the sheet
// when it opened, so it has no momentum to inherit; a drag release does, and
// running that on this fixed curve is a visible seam between dragging and
// animating, the same half-second decel whether you nudged the sheet or flung
// it. See `releaseTransition`.
const DRAWER = { duration: 0.5, ease: EASE_DRAWER } as const;

/**
 * Transition for a sheet let go mid-gesture: a spring handed the pointer's
 * exact release velocity, so the animation continues at the speed the finger
 * was already moving instead of restarting from a standstill.
 */
function releaseTransition(velocity: number) {
  return { ...SPRING_THROW, velocity };
}
const subscribeToClient = () => () => undefined;
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Heights (0-1 = fraction of viewport, or "auto"). First entry is default. */
  snapPoints?: (number | "auto")[];
  defaultSnap?: number;
  title?: string;
  description?: string;
  children?: ReactNode;
  className?: string;
  /** Min drag distance (px) past current snap to dismiss. */
  dismissThreshold?: number;
}

export function BottomSheet({
  open,
  onOpenChange,
  snapPoints = [0.5, 0.92],
  defaultSnap = 0,
  title,
  description,
  children,
  className,
  dismissThreshold = 120,
}: BottomSheetProps) {
  const [snap, setSnap] = useState(defaultSnap);
  // Non-null only between a drag release and the animation that follows it, so
  // the very next transition inherits the fling and every other one does not.
  const [releaseVelocity, setReleaseVelocity] = useState<number | null>(null);
  const mounted = useSyncExternalStore(
    subscribeToClient,
    clientSnapshot,
    serverSnapshot,
  );
  const dragControls = useDragControls();
  const sheetRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const reduce = useReducedMotion();
  const titleId = useId();
  const descriptionId = useId();

  const closeSheet = useCallback(() => {
    setSnap(defaultSnap);
    onOpenChange(false);
  }, [defaultSnap, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSheet();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(
        sheetRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        sheetRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!sheetRef.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (document.activeElement === sheetRef.current) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeSheet, open]);

  // Lock background scroll while open. overflow:hidden alone is ignored by
  // iOS Safari, boundary scrolls inside the sheet chain to the page, which
  // scrolls underneath and ends up somewhere else on close. position:fixed
  // is the lock that actually holds; restore the scroll position after.
  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  // aria-modal does not hide the application from every assistive technology.
  // Make body siblings inert while the portalled sheet is open, then restore
  // their exact prior state on close.
  useEffect(() => {
    if (!open || !sheetRef.current) return;
    const overlay = sheetRef.current.parentElement;
    if (!overlay) return;
    const siblings = Array.from(document.body.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== overlay,
    );
    const previous = siblings.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    for (const element of siblings) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }
    return () => {
      for (const { element, inert, ariaHidden } of previous) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
    };
  }, [open]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const velocity = info.velocity.y;
    setReleaseVelocity(velocity);

    // Where the gesture is *going*, not where the finger stopped. A hard flick
    // from 20px in and a slow drag to 200px used to be judged by two unrelated
    // threshold ladders; both are now one projected landing point.
    const decision = sheetReleaseFor({
      snapPoints: numericSnapPoints,
      currentIndex: snap,
      viewportHeight:
        typeof window === "undefined" ? 0 : window.innerHeight,
      offset: info.offset.y,
      velocity,
      dismissThreshold,
    });

    if (decision.kind === "dismiss") {
      closeSheet();
      return;
    }
    // A detent the sheet actually moved to, not every release: landing back on
    // the snap you started from is not an event worth feeling.
    if (decision.index === snap) {
      // Nothing moves, so `onAnimationComplete` never fires to spend the
      // handoff. Drop it here or the next transition inherits a stale fling.
      setReleaseVelocity(null);
      return;
    }
    haptic("detent");
    setSnap(decision.index);
  };

  // "auto" has no fraction to project against; treat it as the tallest rung so
  // the release maths still has a monotonic ladder to pick from.
  const numericSnapPoints = snapPoints.map((point) =>
    point === "auto" ? 0.92 : point,
  );
  const snapValue = snapPoints[snap];
  const heightStyle =
    snapValue === "auto"
      ? { maxHeight: "92vh" }
      : { height: `${snapValue * 100}vh` };

  // Portal to <body>: an ancestor with backdrop-filter or transform becomes
  // the containing block for fixed descendants, which would position the
  // sheet against that ancestor instead of the viewport.
  if (!mounted) return null;

  return createPortal(
    <AnimatePresence
      onExitComplete={() => {
        setSnap(defaultSnap);
        setReleaseVelocity(null);
        previouslyFocusedRef.current?.focus();
        previouslyFocusedRef.current = null;
      }}
    >
      {open ? (
        <div className="pointer-events-none fixed inset-0 z-50">
          <motion.div
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={DRAWER}
            onClick={closeSheet}
            // A dim scrim with a light blur. backdrop-blur is GPU-expensive and
            // re-rasterizes every frame the sheet drags over it; a small radius
            // plus more opacity keeps the glass look without the jank.
            className="pointer-events-auto absolute inset-0 bg-background/40 backdrop-blur-sm"
          />
          <motion.div
            ref={sheetRef}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.02, bottom: 0.4 }}
            dragMomentum={false}
            onDragEnd={onDragEnd}
            initial={reduce ? { y: 0, opacity: 0 } : { y: "100%" }}
            animate={reduce ? { y: 0, opacity: 1 } : { y: 0 }}
            exit={reduce ? { y: 0, opacity: 0 } : { y: "100%" }}
            transition={
              reduce
                ? { duration: 0.18, ease: EASE_DRAWER }
                : releaseVelocity !== null
                  ? releaseTransition(releaseVelocity)
                  : DRAWER
            }
            onAnimationComplete={() => {
              // Spend the handoff exactly once: the next non-gesture move
              // (open, Escape, a programmatic close) must not inherit a fling
              // the user performed several interactions ago.
              setReleaseVelocity(null);
            }}
            style={heightStyle}
            className={cn(
              "pointer-events-auto absolute bottom-0 left-0 right-0 mx-auto flex max-w-2xl flex-col overflow-hidden rounded-t-3xl will-change-transform",
              "border border-border bg-background shadow-xl",
              className,
            )}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={description ? descriptionId : undefined}
            aria-label={title ? undefined : "Bottom sheet"}
            tabIndex={-1}
          >
            <div
              onPointerDown={(e) => dragControls.start(e)}
              className="flex cursor-grab touch-none flex-col items-center px-4 pb-2 pt-3 active:cursor-grabbing"
            >
              <div className="h-1.5 w-10 rounded-full bg-muted-foreground/40" />
              {title || description ? (
                <div className="mt-3 w-full">
                  {title ? (
                    <h2 id={titleId} className="text-base font-semibold text-foreground">
                      {title}
                    </h2>
                  ) : null}
                  {description ? (
                    <p id={descriptionId} className="mt-0.5 text-sm text-muted-foreground">
                      {description}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            {/* overscroll-contain stops boundary scrolls from chaining to the page. */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6">{children}</div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
