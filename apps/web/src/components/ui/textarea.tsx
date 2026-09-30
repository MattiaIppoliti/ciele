import * as React from "react";

import { cn } from "@/lib/utils";

/* Padding is deliberately roomier than the single-line `Input`'s: a textarea
   holds a paragraph, and at 10px the first line of a project's decisions sat
   against the border with no margin to read into. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      // Browser extensions inject attributes before hydration; ignore them.
      suppressHydrationWarning
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-alpha-medium bg-alpha-lighter px-3 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
