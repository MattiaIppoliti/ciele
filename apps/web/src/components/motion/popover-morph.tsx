"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { usePopoverPortalPosition } from "@/components/motion/popover-position";
import { selectPopupGeometry } from "./select-geometry";
import { EASE_OUT, SPRING_PANEL } from "@/lib/ease";
import { cn } from "@/lib/utils";

type Side = "top" | "bottom";
type Align = "start" | "end";

type MorphContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  triggerId: string;
  contentId: string;
  triggerRef: React.MutableRefObject<HTMLElement | null>;
  contentRef: React.MutableRefObject<HTMLDivElement | null>;
};

const MorphContext = createContext<MorphContextValue | null>(null);

function useMorphContext(component: string) {
  const ctx = useContext(MorphContext);
  if (!ctx) throw new Error(`${component} must be used within <MorphPopover>`);
  return ctx;
}

export interface MorphPopoverProps {
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * A popover whose panel morphs open from the trigger corner: it's laid out at
 * full size but clipped to the corner nearest the trigger, then unclips as one
 * piece. Closes on outside pointer / Escape. Controlled.
 */
export function MorphPopover({
  children,
  open,
  onOpenChange: setOpen,
}: MorphPopoverProps) {
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const toggle = useCallback(() => setOpen(!open), [setOpen, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      triggerRef.current?.focus({ preventScroll: true });
      setOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        rootRef.current &&
        !rootRef.current.contains(target) &&
        !contentRef.current?.contains(target)
      )
        setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open, setOpen]);

  const ctx = useMemo<MorphContextValue>(
    () => ({
      open,
      setOpen,
      toggle,
      triggerId: `${baseId}-trigger`,
      contentId: `${baseId}-content`,
      triggerRef,
      contentRef,
    }),
    [open, setOpen, toggle, baseId],
  );

  return (
    <MorphContext.Provider value={ctx}>
      <div ref={rootRef} className="relative inline-flex">
        {children}
      </div>
    </MorphContext.Provider>
  );
}

export interface MorphPopoverTriggerProps {
  children: ReactElement;
}

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref && typeof ref === "object")
        (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
}

/** Wraps a single element, toggling the popover on click. */
export function MorphPopoverTrigger({ children }: MorphPopoverTriggerProps) {
  const ctx = useMorphContext("MorphPopoverTrigger");
  if (!isValidElement(children)) return children;

  const child = children as ReactElement<Record<string, unknown>>;
  const childOnClick = child.props.onClick as
    | ((e: unknown) => void)
    | undefined;
  const childRef = (child.props as { ref?: Ref<HTMLElement> }).ref;

  return cloneElement(child, {
    id: ctx.triggerId,
    ref: mergeRefs(childRef, ctx.triggerRef),
    onClick: (e: unknown) => {
      childOnClick?.(e);
      ctx.toggle();
    },
    "aria-haspopup": "dialog",
    "aria-expanded": ctx.open,
    "aria-controls": ctx.open ? ctx.contentId : undefined,
  });
}

const originFor = (side: Side, align: Align) =>
  `${side === "bottom" ? "top" : "bottom"} ${align === "end" ? "right" : "left"}`;

// A clip that hides everything but the corner nearest the trigger, so the
// panel appears to grow out of it. inset(top right bottom left).
function clipHidden(side: Side, align: Align, radius: number) {
  const top = side === "bottom" ? "0%" : "92%";
  const bottom = side === "bottom" ? "92%" : "0%";
  const right = align === "end" ? "0%" : "92%";
  const left = align === "end" ? "92%" : "0%";
  return `inset(${top} ${right} ${bottom} ${left} round ${radius}px)`;
}
const clipShown = (radius: number) => `inset(0% 0% 0% 0% round ${radius}px)`;

// Preserve the original spring character on the wrapper, but tween the complex
// clip-path so it cannot snap when the spring resolves its final distance.
const MORPH_CLIP_TRANSITION = { duration: 0.32, ease: EASE_OUT } as const;

export interface MorphPopoverContentProps {
  children: ReactNode;
  side: Side;
  align: Align;
  className?: string;
}

/** Gap between trigger and panel, in px. */
const SIDE_OFFSET = 8;
/** Panel corner radius, in px. */
const RADIUS = 12;

// SSR-safe mount detection without a mount effect: the server snapshot is
// false, the client snapshot true, so the portal renders only after hydration.
const emptySubscribe = () => () => {};

export function MorphPopoverContent({
  children,
  side,
  align,
  className,
}: MorphPopoverContentProps) {
  const { open, triggerId, contentId, triggerRef, contentRef } =
    useMorphContext("MorphPopoverContent");
  const reduce = useReducedMotion() ?? false;
  const portalReady = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const layout = usePopoverPortalPosition(
    triggerRef,
    contentRef,
    portalReady && open,
  );

  useLayoutEffect(() => {
    if (!portalReady || !open) return;
    const content = contentRef.current;
    const trigger = triggerRef.current;
    if (!content) return;

    const frame = window.requestAnimationFrame(() => {
      const firstFocusable = content.querySelector<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      (firstFocusable ?? content).focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (content?.contains(document.activeElement)) {
        trigger?.focus({ preventScroll: true });
      }
    };
  }, [contentRef, open, portalReady, triggerRef]);
  const proposedLeft = layout
    ? align === "end"
      ? layout.trigger.left + layout.trigger.width - layout.content.width
      : layout.trigger.left
    : 0;
  const geometry = layout ? selectPopupGeometry({
    left: proposedLeft, right: proposedLeft + layout.content.width,
    top: layout.trigger.top, bottom: layout.trigger.top + layout.trigger.height,
  }, layout.viewport, { width: layout.content.width, height: layout.content.naturalHeight }, side, Infinity) : null;
  const placement = geometry?.side ?? side;
  const left = proposedLeft + (geometry?.leftOffset ?? 0);
  const top = layout
    ? placement === "bottom"
      ? layout.trigger.top + layout.trigger.height + SIDE_OFFSET
      : layout.trigger.top - Math.min(layout.content.height, geometry?.maxHeight ?? Infinity) - SIDE_OFFSET
    : 0;

  // Both directions travel between the exact same hidden/show states. Exit
  // targets "hidden" directly instead of introducing separate choreography.
  const wrap = reduce
    ? undefined
    : {
        hidden: { opacity: 0, scale: 0.96, transition: SPRING_PANEL },
        show: { opacity: 1, scale: 1, transition: SPRING_PANEL },
      };
  const clip = reduce
    ? undefined
    : {
        hidden: {
          clipPath: clipHidden(placement, align, RADIUS),
          transition: MORPH_CLIP_TRANSITION,
        },
        show: {
          clipPath: clipShown(RADIUS),
          transition: MORPH_CLIP_TRANSITION,
        },
      };

  // Keep the server and first client render identical, then mount the portal.
  if (!portalReady) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          data-morph-popover-portal=""
          // Wrapper carries the shadow as a drop-shadow filter, which hugs the
          // clipped shape below (box-shadow would just get clipped away).
          variants={wrap}
          initial={reduce ? { opacity: 0 } : "hidden"}
          animate={reduce ? { opacity: 1 } : "show"}
          exit={reduce ? { opacity: 0 } : "hidden"}
          transition={reduce ? { duration: 0.12 } : undefined}
          style={{
            left,
            top,
            visibility: layout ? "visible" : "hidden",
            transformOrigin: originFor(placement, align),
          }}
          className="fixed z-[9999] [filter:drop-shadow(0_10px_18px_rgba(0,0,0,0.14))]"
        >
          <motion.div
            ref={contentRef}
            id={contentId}
            role="dialog"
            aria-labelledby={triggerId}
            tabIndex={-1}
            variants={clip}
            style={{ borderRadius: RADIUS, maxHeight: geometry?.maxHeight, maxWidth: geometry?.maxWidth }}
            className={cn(
              "overflow-y-auto overscroll-contain border border-border bg-background",
              className,
            )}
          >
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
