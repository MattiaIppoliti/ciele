"use client";

import {
  createContext,
  useContext,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type PointerEvent,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { Reorder, useDragControls, useReducedMotion } from "motion/react";

type SortableItemContextValue = ReturnType<typeof useDragControls> | null;

const SortableItemContext = createContext<SortableItemContextValue>(null);

export function SortableList({
  values,
  onReorder,
  className,
  children,
  as = "div",
  axis = "y",
  ...props
}: Omit<HTMLAttributes<HTMLElement>, "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd"> & {
  as?: "div" | "tbody" | "tr";
  axis?: "x" | "y";
  values: string[];
  onReorder: (values: string[]) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Reorder.Group
      as={as}
      axis={axis}
      values={values}
      onReorder={onReorder}
      className={className}
      {...props}
    >
      {children}
    </Reorder.Group>
  );
}

export function SortableItem({
  value,
  className,
  style,
  onDragStart,
  onDragEnd,
  children,
  as = "div",
  animateLayout = true,
  ...props
}: Omit<HTMLAttributes<HTMLElement>, "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd"> & {
  as?: "div" | "tr" | "th";
  animateLayout?: boolean;
  value: string;
  className?: string;
  style?: CSSProperties;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  children: ReactNode;
}) {
  const controls = useDragControls();
  const reduceMotion = useReducedMotion();

  return (
    <SortableItemContext value={controls}>
      <Reorder.Item
        as={as}
        {...props}
        value={value}
        dragListener={false}
        dragControls={controls}
        dragMomentum={false}
        dragElastic={0.08}
        layout="position"
        className={className}
        style={{ position: "relative", ...style }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        whileDrag={{
          zIndex: 20,
          scale: reduceMotion || as === "th" ? 1 : 1.01,
          boxShadow: as === "th" ? "var(--elevation-strong)" : "0 16px 36px rgb(15 23 42 / 0.16)",
        }}
        transition={
          reduceMotion || !animateLayout
            ? { duration: 0 }
            : { type: "spring", stiffness: 520, damping: 42, mass: 0.7 }
        }
      >
        {children}
      </Reorder.Item>
    </SortableItemContext>
  );
}

export function SortableHandle({
  onPointerDown,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const controls = useContext(SortableItemContext);
  if (!controls) {
    throw new Error("SortableHandle must be rendered inside SortableItem");
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    onPointerDown?.(event);
    if (event.defaultPrevented || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    controls?.start(event);
  }

  return (
    <button data-slot="sortable-handle" type="button" onPointerDown={startDrag} {...props}>
      {children}
    </button>
  );
}
