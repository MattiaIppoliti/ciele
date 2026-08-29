"use client";

import type { ReactNode, UIEventHandler } from "react";
import { cn, ProgressiveBlur } from "@agent-hub/ui";
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
      {/* Content melts out of focus as it leaves the viewport's bottom edge.
          Fixed positioning is safe here: the header is `fixed z-20` in the
          same tree, so no transformed ancestor re-anchors it. */}
      <ProgressiveBlur tint="var(--background)" />
    </div>
  );
}
