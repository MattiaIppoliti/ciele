"use client";

import { animate, motion, MotionConfig, useReducedMotion } from "motion/react";
import type { HTMLMotionProps } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const THUMB_SPRING = {
  type: "spring",
  stiffness: 800,
  damping: 80,
  mass: 4,
} as const;

export interface SwitchProps
  extends Omit<
    HTMLMotionProps<"button">,
    "checked" | "onChange" | "size"
  > {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
  ariaLabel?: string;
  size?: "sm" | "default";
}

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  label,
  ariaLabel,
  className,
  id,
  size = "default",
  type = "button",
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
  onBlur,
  "aria-label": ariaLabelAttribute,
  ...buttonProps
}: SwitchProps) {
  const generatedId = useId();
  const switchId = id ?? generatedId;
  const thumbRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [isPressed, setIsPressed] = useState(false);
  const [isPointer, setIsPointer] = useState(false);

  useEffect(() => {
    if (!thumbRef.current || reduce || !disabled || !isPressed) return;
    animate(
      thumbRef.current,
      { x: [0, -2, 2, -1, 0] },
      { delay: 0.2, duration: 0.6 },
    );
  }, [disabled, isPressed, reduce]);

  const squish = !disabled && isPointer && isPressed && !reduce;
  const trackSize = size === "sm" ? "h-5 w-9 px-0.5" : "h-7 w-12 px-1";
  const thumbSize = size === "sm" ? "size-4" : "size-5";
  return (
    <MotionConfig transition={reduce ? { duration: 0 } : THUMB_SPRING}>
      <span className={cn("inline-flex items-center gap-3", className)}>
        <motion.button
          {...buttonProps}
          id={switchId}
          type={type}
          role="switch"
          aria-checked={checked}
          aria-label={ariaLabel ?? ariaLabelAttribute}
          disabled={disabled}
          onClick={(event) => {
            onClick?.(event);
            if (!disabled) onCheckedChange(!checked);
          }}
          onPointerDown={(event) => {
            onPointerDown?.(event);
            setIsPressed(true);
            setIsPointer(event.type.startsWith("pointer"));
          }}
          onPointerUp={(event) => {
            onPointerUp?.(event);
            setIsPressed(false);
          }}
          onPointerLeave={(event) => {
            onPointerLeave?.(event);
            setIsPressed(false);
          }}
          onPointerCancel={(event) => {
            onPointerCancel?.(event);
            setIsPressed(false);
          }}
          onBlur={(event) => {
            onBlur?.(event);
            setIsPressed(false);
          }}
          initial={false}
          data-slot="switch"
          data-size={size}
          data-state={checked ? "checked" : "unchecked"}
          data-foley-toggle=""
          className={cn(
            "group peer relative inline-flex shrink-0 cursor-pointer items-center rounded-full outline-none transition-colors duration-200",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:cursor-not-allowed disabled:opacity-60",
            trackSize,
            checked
              ? "justify-end bg-primary"
              : "justify-start bg-muted-foreground/60",
          )}
        >
          <motion.div
            ref={thumbRef}
            layout
            animate={{ scale: squish ? 0.9 : 1 }}
            className={cn(
              "pointer-events-none block rounded-full bg-background shadow-md",
              thumbSize,
            )}
          >
            <span
              className={cn(
                "block",
                thumbSize,
                squish && (checked ? "ml-1" : "mr-1"),
              )}
            />
          </motion.div>
        </motion.button>
        {label ? (
          <label
            htmlFor={switchId}
            className="cursor-pointer text-sm text-foreground"
          >
            {label}
          </label>
        ) : null}
      </span>
    </MotionConfig>
  );
}
