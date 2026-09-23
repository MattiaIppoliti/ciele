"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";

import { cn } from "@/lib/utils";
import { CheckIcon, MinusIcon } from "lucide-react";

/**
 * The unchecked edge is `muted-foreground/40`, not `border-input`.
 *
 * A text input carries a label, a fill and 40px of height; a checkbox is a
 * 16px square whose outline is the entire control, so it cannot borrow the
 * same faint edge. In the light theme `--input` is `oklch(0.922)`, which is
 * `#e4e4e4`: thirteen values from the `#f1f1f1` a table row is drawn on, and
 * exactly the `--table-frame` the heading band uses, so the box in the header
 * disappeared outright. This reads on all three surfaces in both themes and
 * leaves `--input` to the controls it suits.
 */
function Checkbox({
  className,
  indeterminate,
  ...props
}: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      data-foley-toggle=""
      indeterminate={indeterminate}
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-muted-foreground/40 transition-colors outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground dark:data-indeterminate:bg-primary",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        {/* A dash, not a tick, for "some of these": the header box of a table
            with three of twenty rows selected is the one place this matters. */}
        {indeterminate ? <MinusIcon /> : <CheckIcon />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
