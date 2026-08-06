import type { ReactNode } from "react";
import { cn } from "@agent-hub/ui";

/** Shared centered heading block for every top-level marketing page. */
export function MarketingHero({
  eyebrow,
  title,
  children,
  className,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto max-w-3xl text-center", className)}>
      <p className="text-muted-foreground flex items-center justify-center gap-2 font-mono text-xs font-medium uppercase tracking-wider">
        {eyebrow}
      </p>
      <h1 className="text-foreground mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
        {title}
      </h1>
      {children}
    </div>
  );
}
