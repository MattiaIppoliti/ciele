"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import { forwardRef, type ReactNode } from "react";
import { Button as ButtonPrimitive } from "@agent-hub/ui";

export type ButtonVariant = "primary" | "ghost";

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: ButtonVariant;
  children?: ReactNode;
  static?: boolean;
}

const MotionButton = motion.create(ButtonPrimitive);

/** Icon-button compatibility API over the shared geometry and press contract. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = "primary", static: isStatic = false, ...props }, ref) {
    return (
      <MotionButton
        {...props}
        ref={ref}
        type={props.type ?? "button"}
        variant={variant === "primary" ? "default" : "ghost"}
        size="icon"
        static={isStatic}
      />
    );
  },
);
