"use client";

import dynamic from "next/dynamic";
import type { CSSProperties, ReactNode } from "react";
import { usePointerSeen } from "@/lib/hooks/use-pointer-seen";
import { cn } from "@/lib/utils";

/* The glow follows a cursor, so it is worth nothing to a visitor who has not
   moved one, and it is `motion/react` from top to bottom. Loaded on the first
   pointer movement anywhere on the page (see `usePointerSeen`), which is what
   keeps the animation library off the first load of /pricing, /security,
   /download and the feature pages. */
const Spotlight = dynamic(
  () => import("@/components/core/spotlight").then((m) => m.Spotlight),
  { ssr: false, loading: () => null }
);

/**
 * The home page's card treatment, shared by every marketing card grid: a
 * translucent grey rim drawn as a 1.5px inset behind an opaque face, lit by a
 * cursor-following spotlight that only shows through that rim. Defined once so
 * the feature pages and the security page cannot drift apart on hover.
 *
 * The scroll-in reveal is CSS (`.marketing-card-reveal` in home.css, driven by
 * a view timeline), not JavaScript: it used to be the reason this component,
 * and every page rendering it, imported an animation library before it could
 * draw a card. Where view timelines are unsupported the card simply arrives
 * already in place, which is the state the animation ends on anyway.
 *
 * `index` staggers that reveal; pass the position in the grid.
 */
export function SpotlightCard({
  index = 0,
  className,
  faceClassName,
  children,
}: {
  index?: number;
  className?: string;
  faceClassName?: string;
  children: ReactNode;
}) {
  const pointerSeen = usePointerSeen();

  return (
    <div
      className={cn(
        "marketing-card-reveal relative overflow-hidden rounded-2xl bg-zinc-300/30 p-[1.5px] dark:bg-zinc-700/30",
        className
      )}
      style={{ "--card-index": index } as CSSProperties}
    >
      {pointerSeen && (
        <Spotlight
          className="from-sky-400 via-indigo-500 to-transparent blur-2xl dark:from-sky-300 dark:via-indigo-400"
          size={220}
        />
      )}
      <div
        className={cn(
          "bg-card relative flex h-full flex-col rounded-[calc(1rem-1.5px)] p-6",
          faceClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}
