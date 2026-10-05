"use client";

import { animate, motion, useReducedMotion } from "motion/react";
import { forwardRef, useEffect, useId, useRef, type InputHTMLAttributes } from "react";
import { Input as InputPrimitive, Label } from "@agent-hub/ui";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Invalid state and an optional message, using the shared input primitive. */
  error?: string | boolean;
  /** Console geometry is the default; auth forms opt into the taller control. */
  density?: "console" | "comfortable";
  /** Avoid shifting the form when a validation message appears. */
  reserveErrorSpace?: boolean;
  static?: boolean;
}

/** Validation feedback composed around the canonical input and label. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    error,
    density = "console",
    reserveErrorSpace = true,
    static: isStatic = false,
    id: idProp,
    className,
    "aria-describedby": describedBy,
    "aria-invalid": invalid,
    ...rest
  },
  ref,
) {
  const reactId = useId();
  const id = idProp ?? reactId;
  const reduce = useReducedMotion();
  const fieldRef = useRef<HTMLDivElement>(null);
  const hasError = Boolean(error);
  const errorMessage = typeof error === "string" ? error : null;
  const descriptionIds = [describedBy, errorMessage ? `${id}-error` : undefined].filter(Boolean).join(" ") || undefined;

  useEffect(() => {
    const field = fieldRef.current;
    if (!field || reduce || isStatic || !hasError) return;
    const animation = animate(
      field,
      { transform: ["translateX(0px)", "translateX(-2px)", "translateX(2px)", "translateX(0px)"] },
      { duration: 0.15 },
    );
    return () => {
      // Stopping can freeze an interrupted shake at its current offset.
      animation.cancel();
      field.style.removeProperty("transform");
    };
  }, [hasError, reduce, isStatic]);

  return (
    <div data-slot="input-field" data-density={density} className="flex min-w-0 flex-col gap-1.5">
      {label ? <Label htmlFor={id} className="leading-5">{label}</Label> : null}
      <div ref={fieldRef} className="min-w-0">
        <InputPrimitive
          {...rest}
          ref={ref}
          id={id}
          aria-invalid={hasError || invalid || undefined}
          aria-describedby={descriptionIds}
          className={cn(
            "text-foreground transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none",
            density === "comfortable" && "h-11 text-base md:text-base",
            isStatic && "transition-none",
            className,
          )}
        />
      </div>
      {(reserveErrorSpace || errorMessage) && (
        <div className={reserveErrorSpace ? "min-h-4" : undefined}>
          {errorMessage && (
            <motion.p
              id={`${id}-error`}
              role="alert"
              initial={reduce || isStatic ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reduce || isStatic ? 0 : 0.15 }}
              className="text-xs leading-4 text-destructive"
            >
              {errorMessage}
            </motion.p>
          )}
        </div>
      )}
    </div>
  );
});
