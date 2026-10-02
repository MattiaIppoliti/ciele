"use client";

import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";

const StaticAvatar = dynamic(() => import("./static-avatar"));
const AnimatedAvatar = dynamic(() => import("./animated-avatar"));

/** Seeded identity: Members are static; Teammates and group marks opt into motion. */
export function GeneratedAvatar({
  seed,
  size = "size-9",
  className,
  animated = false,
}: {
  seed: string;
  size?: string;
  className?: string;
  animated?: boolean;
}) {
  return (
    <span
      className={cn(size, "inline-flex shrink-0 overflow-hidden rounded-full", className)}
      data-slot="generated-avatar"
      data-avatar-motion={animated ? "animated" : "static"}
      aria-hidden="true"
    >
      {animated ? (
        <AnimatedAvatar seed={seed} />
      ) : (
        <StaticAvatar seed={seed} />
      )}
    </span>
  );
}
