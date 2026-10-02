// Adapted from Arc UI Empty state (MIT), https://uiarc.dev/components/empty-state.
// Copyright (c) 2026 Elia Kuratli. See empty-state.LICENSE.
"use client";

import {
  forwardRef,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useIsPresent,
  useMotionValue,
  type AnimationPlaybackControls,
  type HTMLMotionProps,
  type MotionProps,
  type TargetAndTransition,
  type Transition,
} from "motion/react";
import { Folder } from "lucide-react";
import { EASE_OUT, SPRING_LAYOUT, SPRING_SWAP } from "@/lib/ease";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import styles from "./empty-state.module.css";

export interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
  /** Optional accessible label for the state region. */
  label?: string;
}

const exitFast: Transition = { duration: 0.16, ease: [0.22, 1, 0.36, 1] };
const textIn: TargetAndTransition = {
  opacity: 0,
  y: "0.3em",
  filter: "blur(4px)",
};
const textOut: TargetAndTransition = {
  opacity: 0,
  y: "-0.3em",
  filter: "blur(2px)",
  transition: exitFast,
};
const iconIn: TargetAndTransition = {
  opacity: 0,
  scale: 0.6,
  filter: "blur(2px)",
};
const shown: TargetAndTransition = {
  opacity: 1,
  y: "0em",
  scale: 1,
  filter: "blur(0px)",
};
const fadeOut: TargetAndTransition = {
  opacity: 0,
  transition: { duration: 0.12 },
};

/** Outgoing copies are hidden from assistive tech while they fade. */
const Swap = forwardRef<HTMLSpanElement, HTMLMotionProps<"span">>(
  function Swap(props, ref) {
    const present = useIsPresent();
    return (
      <motion.span
        {...props}
        ref={ref}
        aria-hidden={present ? props["aria-hidden"] : true}
      />
    );
  },
);

/** A new icon component crossfades in; re-rendering the same icon stays still. */
function iconKey(icon: ReactNode) {
  if (!isValidElement(icon)) return "icon";
  const type = icon.type;
  if (typeof type === "string") return type;
  if (typeof type !== "function" && (typeof type !== "object" || type === null))
    return "icon";
  if ("displayName" in type && typeof type.displayName === "string")
    return type.displayName;
  return "name" in type && typeof type.name === "string" ? type.name : "icon";
}

/** Follows its content height. After `morphKey` changes, the height springs from the old size to the new one and then returns to auto, so passive reflows (a resize, a font swap) follow instantly. It clips only while moving, so focus rings stay visible at rest. */
function HeightFrame({
  reduce,
  morphKey,
  children,
}: {
  reduce: boolean;
  morphKey: string;
  children: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const height = useMotionValue<number | "auto">("auto");
  const changedAt = useRef(0);
  useLayoutEffect(() => {
    changedAt.current = performance.now();
  }, [morphKey]);
  useEffect(() => {
    const node = content.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let last: number | undefined;
    let controls: AnimationPlaybackControls | undefined;
    const settle = () => {
      height.jump("auto");
      if (frame.current)
        Object.assign(frame.current.style, { overflow: "", height: "auto" });
    };
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight;
      const current = height.get();
      const from = typeof current === "number" ? current : last;
      last = next;
      controls?.stop();
      if (
        reduce ||
        from === undefined ||
        from === next ||
        performance.now() - changedAt.current > 120
      )
        return settle();
      // Pin the old height before this frame paints, then spring to the new one.
      if (frame.current)
        Object.assign(frame.current.style, {
          overflow: "hidden",
          height: `${from}px`,
        });
      controls = animate(height, [from, next], {
        ...SPRING_LAYOUT,
        onComplete: settle,
      });
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      controls?.stop();
    };
  }, [height, reduce]);
  return (
    <motion.div ref={frame} className={styles.frame} style={{ height }}>
      <div ref={content} className={styles.copy}>
        {children}
      </div>
    </motion.div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
  label,
}: EmptyStateProps) {
  const reduce = usePrefersReducedMotion();
  const glyph = icon ?? <Folder width={24} height={24} strokeWidth={1.5} />;
  const enter: Transition = reduce
    ? { duration: 0.12 }
    : { duration: 0.24, ease: EASE_OUT };
  const visible: TargetAndTransition = reduce
    ? {
        ...shown,
        transition: {
          y: { duration: 0 },
          scale: { duration: 0 },
          filter: { duration: 0 },
        },
      }
    : shown;
  const swap: MotionProps = {
    initial: reduce ? { opacity: 0 } : textIn,
    animate: visible,
    exit: reduce ? fadeOut : textOut,
    transition: enter,
  };
  // The result of an action morphs in place: the icon crossfades and the copy rises in while the old copy leaves.
  return (
    <section
      data-slot="empty-state"
      className={[styles.root, className].filter(Boolean).join(" ")}
      aria-label={label}
    >
      <div className={styles.icon} aria-hidden="true">
        <AnimatePresence mode="popLayout" initial={false}>
          <Swap
            key={iconKey(glyph)}
            className={styles.glyph}
            initial={reduce ? { opacity: 0 } : iconIn}
            animate={visible}
            exit={reduce ? fadeOut : { ...iconIn, transition: exitFast }}
            transition={reduce ? enter : SPRING_SWAP}
          >
            {glyph}
          </Swap>
        </AnimatePresence>
      </div>
      <HeightFrame reduce={reduce} morphKey={`${title}\n${description}`}>
        <h3>
          <AnimatePresence mode="popLayout" initial={false}>
            <Swap key={title} className={styles.line} {...swap}>
              {title}
            </Swap>
          </AnimatePresence>
        </h3>
        <p>
          <AnimatePresence mode="popLayout" initial={false}>
            <Swap key={description} className={styles.line} {...swap}>
              {description}
            </Swap>
          </AnimatePresence>
        </p>
      </HeightFrame>
      {action && <div className={styles.action}>{action}</div>}
    </section>
  );
}

export default EmptyState;
