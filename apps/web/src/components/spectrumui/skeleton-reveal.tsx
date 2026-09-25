"use client";

import * as React from "react";
import { cn } from "@agent-hub/ui";

type SkeletonRevealProps = {
  loading: boolean;
  skeleton: React.ReactNode;
  children: React.ReactNode;
  pulseCount?: number;
  pulseDuration?: number;
  revealDuration?: number;
  className?: string;
};

/**
 * Keeps a shape-matched skeleton in place while content loads, then reveals
 * the real content in the same layout slot. Loading stays controlled by the
 * caller; this component never invents a loading delay.
 */
export function SkeletonReveal({
  loading,
  skeleton,
  children,
  pulseCount = 2,
  pulseDuration = 900,
  revealDuration = 400,
  className,
}: SkeletonRevealProps) {
  const pulseIterations = Math.max(1, Math.floor(pulseCount));
  const pulseMs = Math.max(1, pulseDuration);
  const revealMs = Math.max(0, revealDuration);

  return (
    <div
      className={cn("grid min-w-0", className)}
      aria-busy={loading || undefined}
    >
      <div
        aria-hidden="true"
        className={cn(
          "col-start-1 row-start-1 min-w-0 transition-[opacity,filter] ease-out motion-reduce:transition-none",
          loading
            ? "skeleton-reveal-pulse opacity-100 blur-0"
            : "pointer-events-none opacity-0 blur-[2px]"
        )}
        style={{
          animationDuration: `${pulseMs}ms`,
          animationIterationCount: pulseIterations,
          transitionDuration: `${revealMs}ms`,
        }}
      >
        {skeleton}
      </div>
      <div
        aria-hidden={loading}
        inert={loading}
        className={cn(
          "col-start-1 row-start-1 min-w-0 transition-[opacity,filter] ease-out motion-reduce:transition-none",
          loading ? "pointer-events-none opacity-0 blur-[2px]" : "opacity-100 blur-0"
        )}
        style={{ transitionDuration: `${revealMs}ms` }}
      >
        {children}
      </div>
    </div>
  );
}
