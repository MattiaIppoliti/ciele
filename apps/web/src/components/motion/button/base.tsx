"use client";

import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { forwardRef, type ReactNode } from "react";
import { SPRING_PRESS } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";

export type ButtonVariant = "primary" | "ghost";

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: ButtonVariant;
  children?: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  ghost: "text-muted-foreground hover:text-foreground hover:bg-primary/5",
};

/** An icon-sized button. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = "primary", className, children, ...rest }, ref) {
    const reduce = useReducedMotion();
    const canHover = useHoverCapable();

    return (
      <motion.button
        ref={ref}
        type="button"
        whileTap={reduce ? undefined : { scale: 0.93 }}
        whileHover={reduce || !canHover ? undefined : { scale: 1.02 }}
        transition={SPRING_PRESS}
        className={cn(
          "inline-flex items-center justify-center font-medium select-none",
          "transition-colors",
          "disabled:pointer-events-none disabled:opacity-50",
          VARIANT_CLASS[variant],
          "h-8 w-8 rounded-lg",
          className,
        )}
        {...rest}
      >
        {children}
      </motion.button>
    );
  },
);
