"use client";
// beui.dev/components/blocks/notification-stack

import { CircleCheck, OctagonX, X, type LucideIcon } from "lucide-react";
import { ArrowUpRight, Info, TriangleAlert } from "lucide-react";
import {
  motion,
  useAnimationControls,
  useReducedMotion,
  type PanInfo,
  type Transition,
} from "motion/react";
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { RollInText } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { shouldDismissSwipe } from "@/components/motion/swipe-dismiss";
import { EASE_OUT, SPRING_LAYOUT } from "@/lib/ease";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
import { cn } from "@/lib/utils";

export type NotificationStackItem = {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  /** Drives the card's leading status glyph; omit for a plain card. */
  status?: NotificationStackStatus;
};

export interface NotificationStackProps {
  items: NotificationStackItem[];
  onViewAll: () => void;
  /**
   * Where "View all" goes. With it, the expanded stack is covered by a real
   * link, so Cmd-click and middle-click open a new tab; `onViewAll` still
   * answers the keyboard, which reaches the stack button instead.
   */
  viewAllHref?: string;
  /**
   * The top-right dismiss control, and phone-style swipe-right-to-dismiss.
   */
  onClose: () => void;
  collapsedLabel: string;
  expandedLabel: string;
  className?: string;
}

export type NotificationStackStatus = "success" | "error" | "warning" | "info";

/** Status glyphs match the toast icon set so both surfaces read the same. */
const STATUS_ICONS: Record<
  NotificationStackStatus,
  { Icon: LucideIcon; className: string; label: string }
> = {
  success: {
    Icon: CircleCheck,
    className: "text-emerald-600 dark:text-emerald-400",
    label: "Success",
  },
  error: {
    Icon: OctagonX,
    className: "text-destructive",
    label: "Error",
  },
  warning: {
    Icon: TriangleAlert,
    className: "text-amber-600 dark:text-amber-400",
    label: "Warning",
  },
  info: {
    Icon: Info,
    className: "text-muted-foreground",
    label: "Info",
  },
};

const STACK_PEEK = 8;
const STACK_INSET = 12;
/** Long enough to cross the gap to the dismiss control, short enough to feel immediate. */
const HOVER_COLLAPSE_GRACE_MS = 180;

function NotificationCardContent({ item }: { item: NotificationStackItem }) {
  const status = item.status ? STATUS_ICONS[item.status] : null;

  return (
    <span className="flex min-w-0 flex-col gap-1.5 py-4">
      <span className="flex min-w-0 items-start justify-between gap-3">
        <span className="flex min-w-0 items-start gap-2 text-sm leading-snug font-medium">
          {status ? (
            <>
              <status.Icon
                className={cn("mt-px size-4 shrink-0", status.className)}
                aria-hidden="true"
              />
              <span className="sr-only">{status.label}: </span>
            </>
          ) : null}
          <span className="min-w-0">{item.title}</span>
        </span>
        {item.trailing ? (
          <span className={cn("shrink-0 text-xs", "text-muted-foreground")}>
            {item.trailing}
          </span>
        ) : null}
      </span>
      {item.description ? (
        <span
          className={cn(
            "text-muted-foreground text-xs leading-relaxed",
            "line-clamp-2",
          )}
        >
          {item.description}
        </span>
      ) : null}
    </span>
  );
}

export function NotificationStack({
  items,
  onViewAll,
  viewAllHref,
  onClose,
  collapsedLabel,
  expandedLabel,
  className,
}: NotificationStackProps) {
  const reduce = useReducedMotion();
  const canHover = useHoverCapable();
  const hasFocus = useRef(false);
  const swipe = useAnimationControls();
  // A drag ends with a click event on the stack button; this keeps the release
  // from also expanding or "View all"-ing the banner on the way out.
  const didDrag = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLSpanElement>(null);
  // The expanded stack grows upward out of the root's collapsed footprint, so
  // the dismiss control has to ride that edge instead of sitting still.
  const [closeOffset, setCloseOffset] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  // Pending hover collapse; see the pointer handlers on the root.
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelCollapse = () => {
    if (collapseTimer.current === null) return;
    clearTimeout(collapseTimer.current);
    collapseTimer.current = null;
  };
  useEffect(() => cancelCollapse, []);

  const primaryItem = items[0];
  const noun = items.length === 1 ? "notification" : "notifications";
  const transition: Transition = reduce ? { duration: 0 } : SPRING_LAYOUT;
  const cardTransition: Transition = reduce
    ? { duration: 0 }
    : { duration: 0.32, ease: EASE_OUT };
  const backgroundTransition: Transition = reduce
    ? { duration: 0 }
    : { duration: 0.26, ease: EASE_OUT };

  // Layout settles synchronously when the stack fans out (the cards move to
  // their own grid rows); only the muted shell animates. Measuring here gives
  // the control its target so it can travel on the same curve.
  useEffect(() => {
    const root = rootRef.current;
    const shell = shellRef.current;
    if (!root || !shell) return;
    setCloseOffset(
      shell.getBoundingClientRect().top - root.getBoundingClientRect().top,
    );
  }, [onClose, isExpanded, items.length]);

  const handleBlur = (event: FocusEvent<HTMLButtonElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    hasFocus.current = false;
    // Pressing the "View all" link moves focus onto it; collapsing here would
    // unmount the link before its click lands.
    if (viewAllHref && rootRef.current?.contains(event.relatedTarget)) return;
    setIsExpanded(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setIsExpanded(false);
    event.currentTarget.blur();
  };

  const handleDragEnd = (_event: unknown, info: PanInfo) => {
    if (!shouldDismissSwipe({ offset: info.offset.x, velocity: info.velocity.x })) {
      void swipe.start({ x: 0 }, reduce ? { duration: 0 } : SPRING_LAYOUT);
      return;
    }

    // Follow the finger off the right edge, then hand over to the same
    // dismissal the close control uses.
    void swipe
      .start(
        { x: "115%", opacity: 0 },
        reduce ? { duration: 0 } : { duration: 0.22, ease: EASE_OUT },
      )
      .then(() => {
        // The banner usually unmounts here; reset anyway so a still-mounted
        // stack (an alert that outlives the dismissal) is not left off-screen.
        swipe.set({ x: 0, opacity: 1 });
        onClose();
      });
  };

  const handleClick = () => {
    if (didDrag.current) {
      didDrag.current = false;
      return;
    }

    if (!isExpanded) {
      setIsExpanded(true);
      return;
    }

    onViewAll();
  };

  return (
    // The stack itself is one big button, so the dismiss control has to be a
    // sibling, a button inside a button is invalid markup.
    <motion.div
      ref={rootRef}
      // Swipe right to dismiss, like a phone notification. Leftward travel is
      // near-rigid slack that springs back, so the gesture reads one-way.
      drag="x"
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0.05, right: 0.9, top: 0, bottom: 0 }}
      dragMomentum={false}
      animate={swipe}
      onPointerDown={() => {
        didDrag.current = false;
      }}
      onDragStart={() => {
        didDrag.current = true;
      }}
      onDragEnd={handleDragEnd}
      // Hover lives here, not on the stack button: the dismiss control sits
      // outside that button's box, and chasing a control that collapses the
      // moment you reach for it is worse than no control.
      //
      // The dismiss control rides up with the fanned-out stack and overhangs
      // its rounded corner, so reaching for it crosses a sliver outside the
      // root. Collapsing there at once slid the control back down under a
      // still pointer, re-entered, expanded, and looped. So collapse waits out
      // a short grace that re-entry cancels, and expanding takes a real
      // pointer move: a control sliding under a resting cursor fires enter,
      // never move.
      onPointerMove={() => {
        cancelCollapse();
        if (canHover && !isExpanded) setIsExpanded(true);
      }}
      onPointerLeave={() => {
        if (!canHover || hasFocus.current) return;
        cancelCollapse();
        collapseTimer.current = setTimeout(() => {
          collapseTimer.current = null;
          if (!hasFocus.current) setIsExpanded(false);
        }, HOVER_COLLAPSE_GRACE_MS);
      }}
      className={cn(
        "relative w-full max-w-[22rem]",
        // touch-pan-y keeps vertical page scrolling working on the card.
        "touch-pan-y",
        className,
      )}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        // Rides the shell's top edge as the stack fans out; the CSS
        // transition matches the shell's own easing.
        style={{ transform: `translateY(${closeOffset}px)` }}
        // Floats just outside the muted shell's top-right corner so it
        // costs the banner no height and never covers a card.
        className="group border-border/60 bg-background text-muted-foreground hover:text-foreground focus-visible:ring-ring focus-visible:ring-offset-background absolute -top-3 -right-3 z-20 flex cursor-pointer items-center rounded-full border p-1.5 text-xs font-medium shadow-sm transition-[transform,color] duration-300 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none"
      >
        <X className="size-3.5 shrink-0" aria-hidden="true" />
        {/* Collapsed to zero width until hover/focus opens the label. */}
        <span
          aria-hidden="true"
          className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-200 ease-out group-hover:grid-cols-[1fr] group-focus-visible:grid-cols-[1fr] motion-reduce:transition-none"
        >
          <span className="min-w-0 overflow-hidden">
            <span className="block pr-0.5 pl-1 whitespace-nowrap">
              Close
            </span>
          </span>
        </span>
      </button>
      {isExpanded && viewAllHref ? (
        // Pointer only: it covers the expanded shell (the root's box is the
        // collapsed footprint, so it rides the same offset as the dismiss
        // control) and sits under that control. Keyboard users already have
        // the stack button, so a second tab stop would be a duplicate.
        <Link
          href={viewAllHref}
          tabIndex={-1}
          aria-hidden="true"
          draggable={false}
          onClick={(event) => {
            if (!didDrag.current) return;
            didDrag.current = false;
            event.preventDefault();
          }}
          style={{ top: closeOffset }}
          className="absolute inset-x-0 bottom-0 z-[15] cursor-pointer rounded-3xl"
        />
      ) : null}
      <motion.button
        type="button"
        initial={false}
        aria-expanded={isExpanded}
        aria-label={
          isExpanded
            ? `${items.length} ${noun}. ${expandedLabel}.`
            : `${items.length} ${noun}. Expand notifications.`
        }
        onFocus={() => {
          hasFocus.current = true;
          setIsExpanded(true);
        }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        className={cn(
          "text-foreground relative z-10 block w-full cursor-pointer rounded-3xl text-left outline-none",
          "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2",
        )}
      >
        {/* This invisible first card gives the button its compact intrinsic footprint. */}
        <span aria-hidden="true" className="invisible block p-3">
          <span className="block">
            <span className="block rounded-2xl border border-transparent px-4">
              <NotificationCardContent item={primaryItem} />
            </span>
          </span>
          <span className="mt-2 block h-9" />
        </span>

        <span ref={shellRef} className="absolute inset-x-0 bottom-0 block p-3">
          <motion.span
            aria-hidden="true"
            layout
            initial={false}
            transition={backgroundTransition}
            className="bg-muted absolute inset-0 rounded-3xl"
          />
          <span
            className={cn(
              "relative z-10 grid gap-1",
              !isExpanded && "pb-2",
            )}
          >
            {items.map((item, index) => {
              const isPrimary = index === 0;

              return (
                <motion.span
                  key={item.id}
                  layout="position"
                  initial={false}
                  animate={{
                    y: isExpanded ? 0 : index * STACK_PEEK,
                    clipPath: isExpanded
                      ? "inset(0px 0px round 16px)"
                      : `inset(0px ${index * STACK_INSET}px round 16px)`,
                  }}
                  transition={cardTransition}
                  className="border-border/60 bg-background block rounded-2xl border px-4"
                  style={{
                    zIndex: items.length - index,
                    gridColumn: 1,
                    gridRow: isExpanded ? index + 1 : 1,
                  }}
                >
                  <span
                    className={cn(
                      "block",
                      !isPrimary && !isExpanded && "invisible",
                    )}
                  >
                    <NotificationCardContent item={item} />
                  </span>
                </motion.span>
              );
            })}
          </span>

          <motion.span
            layout="position"
            transition={transition}
            className="relative z-10 mt-2 flex min-h-9 items-center gap-2 px-1"
          >
            <span className="bg-foreground text-background grid size-7 shrink-0 place-items-center rounded-full text-xs font-medium shadow-[inset_0_1px_2px_rgb(0_0_0/0.2),inset_0_-1px_0_rgb(255_255_255/0.16)]">
              <RollingNumber value={items.length} />
            </span>
            {/* One rolling line rather than a swap of two: the count's noun
                changes with it ("alert" to "alerts"), and that rolls too. */}
            <span className="flex items-center gap-1 text-sm font-medium whitespace-nowrap">
              <RollInText
                text={isExpanded ? expandedLabel : collapsedLabel}
                duration={380}
              />
              {isExpanded ? (
                <ArrowUpRight className="size-4" aria-hidden="true" />
              ) : null}
            </span>
          </motion.span>
        </span>
      </motion.button>
    </motion.div>
  );
}
