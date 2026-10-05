"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { useId, type ReactNode } from "react";
import { Label } from "@agent-hub/ui";
import { cn } from "@/lib/utils";

export type SwitchProps = SwitchPrimitive.Root.Props & {
  size?: "sm" | "default";
  label?: ReactNode;
  ariaLabel?: string;
  /** Keep the state cue while disabling thumb travel. */
  static?: boolean;
};

/** The single switch primitive used by both compatibility import paths. */
function Switch({
  className,
  size = "default",
  label,
  ariaLabel,
  static: isStatic = false,
  id,
  "aria-label": ariaLabelAttribute,
  ...props
}: SwitchProps) {
  const generatedId = useId();
  const switchId = id ?? generatedId;
  const control = (
    <SwitchPrimitive.Root
      {...props}
      id={switchId}
      aria-label={ariaLabel ?? ariaLabelAttribute}
      data-slot="switch"
      data-size={size}
      data-static={isStatic || undefined}
      data-foley-toggle=""
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent outline-none after:absolute after:top-1/2 after:left-1/2 after:min-h-[44px] after:min-w-[44px] after:-translate-x-1/2 after:-translate-y-1/2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-5 data-[size=default]:w-9 data-[size=sm]:h-4 data-[size=sm]:w-7 data-checked:bg-primary data-unchecked:bg-muted-foreground/50 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        !isStatic && "transition-[background-color,border-color,box-shadow] duration-150 focus-visible:transition-none motion-reduce:transition-none",
        className,
      )}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full ring-0 data-unchecked:bg-foreground data-checked:bg-primary-foreground group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-checked:translate-x-[calc(1.25rem-3px)] group-data-[size=sm]/switch:data-checked:translate-x-[calc(1rem-3px)] data-unchecked:translate-x-px",
          !isStatic && "transition-transform duration-150 ease-out group-focus-visible/switch:transition-none motion-reduce:transition-none",
        )}
      />
    </SwitchPrimitive.Root>
  );

  return label ? (
    <span className="inline-flex items-center gap-3">
      {control}
      <Label htmlFor={switchId} className={cn("cursor-pointer leading-5", props.disabled && "cursor-not-allowed opacity-50")}>{label}</Label>
    </span>
  ) : control;
}

export { Switch };
