"use client";

import {
  createContext,
  useContext,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type PointerEvent,
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
}: {
  values: string[];
  onReorder: (values: string[]) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Reorder.Group
      as="div"
      axis="y"
      values={values}
      onReorder={onReorder}
      className={className}
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
}: {
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
        as="div"
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
          scale: reduceMotion ? 1 : 1.01,
          boxShadow: "0 16px 36px rgb(15 23 42 / 0.16)",
        }}
        transition={
          reduceMotion
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
    if (event.defaultPrevented || event.button !== 0) return;
    event.preventDefault();
    controls?.start(event);
  }

  return (
    <button type="button" onPointerDown={startDrag} {...props}>
      {children}
    </button>
  );
}
