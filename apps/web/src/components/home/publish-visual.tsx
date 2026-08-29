"use client";

import { ChevronRight } from "lucide-react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { useContext, useEffect } from "react";
import { Visual2 } from "@/components/core/visual-2";
import { AmbientActiveContext } from "@/components/home/use-in-viewport";
import { EASE_OUT } from "@/lib/ease";

/** Swipe-to-publish control: the handle auto-demos across the track and loops.
 * No success/green state, no confetti, it just conveys the swipe affordance,
 * then slides away with its Layer2 slot on card hover. */
function SwipeTrack() {
  const reduce = useReducedMotion();
  // Pause the auto-demo loop when the Features section is off screen (null =
  // no provider, e.g. inside the opened dialog → treat as active).
  const active = useContext(AmbientActiveContext) ?? true;
  const progress = useMotionValue(0);
  const left = useTransform(
    progress,
    (v) => `calc(${v} * (100% - 42px) + 3px)`
  );

  useEffect(() => {
    if (reduce) {
      progress.set(0.5);
      return;
    }
    if (!active) {
      progress.set(0);
      return;
    }
    let mounted = true;
    (async () => {
      while (mounted) {
        progress.set(0);
        await new Promise((r) => setTimeout(r, 250));
        if (!mounted) break;
        await animate(progress, 1, { duration: 1.4, ease: EASE_OUT }).finished;
        if (!mounted) break;
        // Brief beat at the end, then loop straight back.
        await new Promise((r) => setTimeout(r, 150));
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce, active]);

  return (
    <div className="border-border bg-background/80 relative h-9 w-[200px] overflow-hidden rounded-lg border shadow-sm backdrop-blur-sm">
      <motion.div
        className="bg-foreground text-background absolute top-[3px] grid h-[calc(100%-6px)] w-9 place-items-center rounded-md"
        style={{ left: reduce ? 3 : left }}
      >
        <ChevronRight className="size-3.5" aria-hidden="true" />
      </motion.div>
      <div className="flex h-full w-full items-center justify-center">
        <span className="text-muted-foreground text-xs select-none">
          Swipe to publish
        </span>
      </div>
    </div>
  );
}

/**
 * Publish card visual: the badtz-ui "Visual 2" animated graph in neutral grey,
 * with the swipe-to-publish control standing in for the default caption. On
 * card hover the swipe slides down and fades while the donut chart and channel
 * tags animate in.
 */
export function PublishVisual() {
  return (
    <div className="group/animated-card bg-card relative flex h-[180px] items-center justify-center overflow-hidden">
      <Visual2
        mainColor="#71717a"
        secondaryColor="#a1a1aa"
        gridColor="#8080801f"
        label={<SwipeTrack />}
      />
    </div>
  );
}
