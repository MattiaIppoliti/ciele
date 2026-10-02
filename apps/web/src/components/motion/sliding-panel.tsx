"use client";

// Based on the Sliding Panel supplied by the user: https://skecher-ui.com/docs/sliding-panel.
import {
  AnimatePresence,
  motion,
  useAnimationControls,
  useIsPresent,
  type Transition,
  type Variants,
} from "motion/react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type Key,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

export type SlidingPanelDirection = -1 | 1;
type PanelMotionState = {
  direction: SlidingPanelDirection;
  mode: "slide" | "fade" | "instant";
};
export const SLIDING_PANEL_TRANSITION: Transition = {
  duration: 0.22,
  ease: [0.23, 1, 0.32, 1],
};
export const slidingPanelVariants: Variants = {
  initial: ({ direction, mode }: PanelMotionState) => ({
    opacity: mode === "instant" ? 1 : 0,
    x: mode === "slide" ? `${direction * 100}%` : "0%",
  }),
  animate: ({ mode }: PanelMotionState) => ({
    opacity: 1,
    x: "0%",
    transition:
      mode === "instant"
        ? { duration: 0 }
        : mode === "fade"
          ? { duration: 0.15 }
          : undefined,
  }),
  exit: ({ direction, mode }: PanelMotionState) => ({
    opacity: mode === "instant" ? 1 : 0,
    x: mode === "slide" ? `${-direction * 100}%` : "0%",
    transition:
      mode === "instant"
        ? { duration: 0 }
        : mode === "fade"
          ? { duration: 0.15 }
          : undefined,
  }),
};
export function useSlidingDirection(
  activeKey: Key,
  keys: readonly Key[],
): SlidingPanelDirection {
  const [selection, setSelection] = useState<{
    key: Key;
    direction: SlidingPanelDirection;
  }>({ key: activeKey, direction: 1 });
  if (selection.key !== activeKey) {
    const before = keys.indexOf(selection.key),
      after = keys.indexOf(activeKey);
    const direction: SlidingPanelDirection =
      before >= 0 && after >= 0 && after < before ? -1 : 1;
    setSelection({ key: activeKey, direction });
    return direction;
  }
  return selection.direction;
}
export type SlidingPanelProps = Omit<ComponentProps<"div">, "children"> & {
  activeKey: Key;
  children: ReactNode;
  direction?: SlidingPanelDirection;
  motionEnabled?: boolean;
  panelClassName?: string;
  transition?: Transition;
  /** Flow layout supports content with natural height; fill matches the supplied component. */
  sizing?: "flow" | "fill";
};
function PresencePanel({
  children,
  state,
  className,
  sizing,
  transition,
}: {
  children: ReactNode;
  state: PanelMotionState;
  className?: string;
  sizing: "flow" | "fill";
  transition: Transition;
}) {
  const present = useIsPresent();
  return (
    <motion.div
      custom={state}
      variants={slidingPanelVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={transition}
      inert={!present}
      aria-hidden={!present}
      data-slot="sliding-panel-content"
      className={cn(
        sizing === "fill" || !present
          ? "absolute inset-0 h-full w-full"
          : "relative w-full",
        className,
      )}
    >
      {children}
    </motion.div>
  );
}
export function SlidingPanel({
  activeKey,
  children,
  className,
  direction = 1,
  motionEnabled = true,
  panelClassName,
  transition = SLIDING_PANEL_TRANSITION,
  sizing = "fill",
  ...props
}: SlidingPanelProps) {
  const reduce = usePrefersReducedMotion();
  const state: PanelMotionState = {
    direction,
    mode: !motionEnabled ? "instant" : reduce ? "fade" : "slide",
  };
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden",
        sizing === "fill" && "h-full",
        className,
      )}
      data-slot="sliding-panel"
      {...props}
    >
      <AnimatePresence custom={state} initial={false} mode="sync">
        <PresencePanel
          key={activeKey}
          state={state}
          sizing={sizing}
          className={panelClassName}
          transition={transition}
        >
          {children}
        </PresencePanel>
      </AnimatePresence>
    </div>
  );
}

/** Persistent siblings animate together without remounting a form or its fields. */
export function SlidingTabPanel({
  active,
  direction,
  children,
  className,
  ...props
}: ComponentProps<"div"> & {
  active: boolean;
  direction: SlidingPanelDirection;
}) {
  const reduce = usePrefersReducedMotion();
  const controls = useAnimationControls();
  const [phase, setPhase] = useState({ active, visible: active });
  if (phase.active !== active) setPhase({ active, visible: true });
  const previous = useRef(active);
  const initialized = useRef(false);
  useLayoutEffect(() => {
    const state: PanelMotionState = {
      direction,
      mode: reduce ? "fade" : "slide",
    };
    if (!initialized.current) {
      initialized.current = true;
      controls.set({ opacity: active ? 1 : 0, x: "0%" });
      return;
    }
    if (previous.current === active) {
      void controls.start({
        opacity: active ? 1 : 0,
        x: "0%",
        transition: { duration: 0 },
      });
      return;
    }
    previous.current = active;
    if (active) {
      controls.set({ opacity: 0, x: reduce ? "0%" : `${direction * 100}%` });
      void controls.start({
        opacity: 1,
        x: "0%",
        transition: reduce ? { duration: 0.15 } : SLIDING_PANEL_TRANSITION,
      });
    } else {
      void controls.start({
        opacity: 0,
        x: state.mode === "slide" ? `${-direction * 100}%` : "0%",
        transition: reduce ? { duration: 0.15 } : SLIDING_PANEL_TRANSITION,
      });
    }
    return () => {
      controls.stop();
    };
  }, [active, controls, direction, reduce]);
  return (
    <div
      {...props}
      hidden={!active && !phase.visible}
      style={!active && !phase.visible ? { display: "none" } : undefined}
      inert={!active}
      aria-hidden={!active}
      className={cn(
        "col-start-1 row-start-1 min-w-0",
        !active && "pointer-events-none absolute inset-0",
        className,
      )}
    >
      <motion.div
        initial={false}
        animate={controls}
        onAnimationComplete={() =>
          setPhase((current) =>
            current.active ? current : { active: false, visible: false },
          )
        }
        className="h-full min-h-0 w-full"
        data-slot="sliding-tab-content"
      >
        {children}
      </motion.div>
    </div>
  );
}
export default SlidingPanel;
