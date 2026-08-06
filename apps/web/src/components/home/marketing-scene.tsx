"use client";

import type { ReactNode, UIEventHandler } from "react";
import { cn } from "@agent-hub/ui";
import { HeroClouds } from "@/components/home/hero-clouds";

/** Shared scroll surface and opening cloud pair for public marketing pages. */
export function MarketingScene({
  children,
  className,
  onScroll,
  showClouds = true,
}: {
  children: ReactNode;
  className?: string;
  onScroll?: UIEventHandler<HTMLDivElement>;
  showClouds?: boolean;
}) {
  return (
    <div
      className={cn("home-scene relative h-full overflow-y-auto", className)}
      onScroll={onScroll}
    >
      {showClouds && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[34rem] overflow-hidden">
          <HeroClouds />
        </div>
      )}
      {children}
    </div>
  );
}
