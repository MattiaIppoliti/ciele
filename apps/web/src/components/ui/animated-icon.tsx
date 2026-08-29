"use client";

/**
 * The animated-icon system is its own package, `ciele-animated-icons` on npm:
 * 77 motion-drawn glyphs, the `createAnimatedIcon` factory and the
 * lucide→animated registry. It left this tree because none of it is product
 * logic, and 4.6k lines of SVG made every search through `components/ui`
 * noisier.
 *
 * This module stays as the app's import path so the ~100 call sites keep
 * reading `@/components/ui/animated-icon`.
 */
export {
  AnimatedIcon,
  AnimateIcons,
  StaticIcons,
  type AnimatedIconHandle,
} from "ciele-animated-icons";

import type { ComponentType, HTMLAttributes } from "react";
import { useEffect, useRef } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "ciele-animated-icons";
import { cn } from "@/lib/utils";

/** Mirrors the package's own host lookup, so both animate from the same place. */
const HOST_SELECTOR =
  "a,button,[role='button'],[role='menuitem'],[data-animate-group]";
/** And its lead-in, so a hovered control's icons start together. */
const START_DELAY_MS = 135;

/**
 * `AnimatedIcon` for a glyph that is not in the package's lucide→animated
 * registry, because it lives in this tree (see `ui/icons/`).
 *
 * The registry is keyed by lucide component and closed to additions from
 * outside the package, so a local glyph cannot go through `AnimatedIcon`. What
 * it needs from it is the hover behaviour, not the lookup: the animation plays
 * from the nearest interactive ancestor, so hovering anywhere on a button
 * animates its icon, and reduced motion leaves it still.
 */
export function AnimatedGlyph({
  icon: Icon,
  size = 16,
  className,
  ...spanProps
}: HTMLAttributes<HTMLSpanElement> & {
  icon: ComponentType<AnimatedIconProps & { ref?: React.Ref<AnimatedIconHandle> }>;
  size?: number;
}) {
  const handleRef = useRef<AnimatedIconHandle>(null);
  const hostRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const span = hostRef.current;
    if (!span) return;
    const host = span.closest(HOST_SELECTOR) ?? span;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      timer = setTimeout(
        () => handleRef.current?.startAnimation(),
        START_DELAY_MS
      );
    };
    const stop = () => {
      clearTimeout(timer);
      handleRef.current?.stopAnimation();
    };
    host.addEventListener("mouseenter", start);
    host.addEventListener("mouseleave", stop);
    return () => {
      clearTimeout(timer);
      host.removeEventListener("mouseenter", start);
      host.removeEventListener("mouseleave", stop);
    };
  }, []);

  return (
    <span
      ref={hostRef}
      // `inline-flex` and centred, not the span's default `inline`: the icon
      // renders its own block `<div>`, and an inline box wrapping a block child
      // takes its height from `line-height` instead of from the glyph. Beside a
      // lucide icon, which is a bare 16px `<svg>`, that made the animated one a
      // taller box with its glyph pinned to the top, so it sat visibly higher
      // than its neighbours in the same row of buttons.
      //
      // `[&_svg]:block` for the other half of it: an inline `<svg>` inside that
      // div reserves descender space under itself, which is the same pixel or
      // two of drift one level down.
      //
      // The span carries the size and the svg is forced to fill it, `!` and all.
      // `Button` sizes icon descendants with shadcn's
      // `[&_svg:not([class*='size-'])]:size-3.5`, and that guard only spares an
      // svg that carries a `size-` class of its own. This svg is rendered by the
      // icon component, so nothing here can put a class on it: its `width`/
      // `height` attributes lost to that rule and a 16px glyph came out 14px
      // beside its 16px lucide neighbours. The `!` beats the selector rather
      // than trying to out-specify it.
      style={{ width: size, height: size }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center [&_svg]:block [&_svg]:size-full!",
        className
      )}
      // The handle is what drives the icon, so its own hover listeners stay
      // quiet (that is what passing a ref means here).
      {...spanProps}
    >
      <Icon ref={handleRef} size={size} />
    </span>
  );
}
