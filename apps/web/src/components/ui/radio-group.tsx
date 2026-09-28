"use client";

import type { ReactNode } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { cn } from "@/lib/utils";

/**
 * A labelled radio set on Base UI's primitives. Each option is its own
 * `<label>`, so the whole row is the hit target, and it carries
 * `data-foley-toggle="switch"` like the app's other single-choice controls.
 */
export function RadioGroup({
  value,
  onValueChange,
  options,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: ReactNode; hint?: ReactNode; disabled?: boolean }>;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <RadioGroupPrimitive
      value={value}
      onValueChange={(next) => onValueChange(next as string)}
      aria-label={ariaLabel}
      className={cn("grid gap-2", className)}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            "press-control flex items-start gap-3 text-sm",
            option.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
          )}
        >
          <Radio.Root
            value={option.value}
            disabled={option.disabled}
            data-foley-toggle="switch"
            className="border-input data-[checked]:border-primary data-[checked]:bg-primary focus-visible:ring-ring/50 mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border outline-none focus-visible:ring-[3px]"
          >
            <Radio.Indicator className="bg-primary-foreground size-1.5 rounded-full" />
          </Radio.Root>
          <span className="grid gap-0.5">
            <span className="font-medium">{option.label}</span>
            {option.hint && <span className="text-muted-foreground text-xs">{option.hint}</span>}
          </span>
        </label>
      ))}
    </RadioGroupPrimitive>
  );
}
