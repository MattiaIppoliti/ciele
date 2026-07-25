"use client";

import { useAnimation } from "motion/react";
import type { HTMLAttributes, ReactNode } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

/** The controls object returned by motion's `useAnimation()`. */
type AnimationControls = ReturnType<typeof useAnimation>;

/**
 * Imperative handle every animated icon exposes. Providing a ref flips the
 * icon into "controlled" mode: its own hover listeners go quiet and the caller
 * (see `AnimatedIcon`) drives the animation from the nearest interactive
 * ancestor instead.
 */
export interface AnimatedIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

export interface AnimatedIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

interface CreateOptions {
  /** Custom "play" — defaults to `controls.start("animate")`. */
  start?: (controls: AnimationControls) => void | Promise<void>;
  /** Custom "reset" — defaults to `controls.start("normal")`. */
  stop?: (controls: AnimationControls) => void | Promise<void>;
}

/**
 * Builds a hover-animated lucide-style icon from just its SVG body, factoring
 * out the identical scaffold every `@lucide-animated` icon repeated (~90 lines
 * each): the wrapper div, the `useAnimation` controls, controlled-vs-uncontrolled
 * hover handling, and the imperative handle. Pass a render function that draws
 * the SVG using the supplied `controls` (and `size`); the variants/consts stay
 * module-local in the icon file and are closed over by `render`.
 *
 * Behaviour is identical to the hand-written components: uncontrolled, the icon
 * plays on its own hover; given a ref it goes controlled and the handle drives it.
 */
export function createAnimatedIcon(
  render: (controls: AnimationControls, size: number) => ReactNode,
  options?: CreateOptions,
) {
  const Icon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
    ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
      const controls = useAnimation();
      const isControlledRef = useRef(false);

      const start = useCallback(() => {
        if (options?.start) return options.start(controls);
        return controls.start("animate");
      }, [controls]);

      const stop = useCallback(() => {
        if (options?.stop) return options.stop(controls);
        return controls.start("normal");
      }, [controls]);

      useImperativeHandle(ref, () => {
        isControlledRef.current = true;
        return { startAnimation: start, stopAnimation: stop };
      });

      const handleMouseEnter = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
          if (isControlledRef.current) onMouseEnter?.(e);
          else start();
        },
        [start, onMouseEnter],
      );

      const handleMouseLeave = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
          if (isControlledRef.current) onMouseLeave?.(e);
          else stop();
        },
        [stop, onMouseLeave],
      );

      return (
        <div
          className={cn("inline-flex items-center justify-center", className)}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          {...props}
        >
          {render(controls, size)}
        </div>
      );
    },
  );
  Icon.displayName = "AnimatedIcon";
  return Icon;
}
