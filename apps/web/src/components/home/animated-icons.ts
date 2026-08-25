"use client";

import React from "react";
import type { AnimatedIcon } from "@/components/ui/animated-icon";

/* The docs tiles are the only animated icons the marketing header draws, and
   importing `animated-icon` eagerly is what put its whole barrel, ~75 animated
   variants plus the ~80 lucide glyphs its lookup map keys on, into every public
   page, for 12 tiles behind a hover. Measured at ~16-18 KB gzip per route on
   /home, /pricing, /features/*, /security and /policies/*.

   Same treatment the hero mock already gets in preview-panes.tsx: render the
   plain lucide glyph, fetch the animated module on the first pointer into the
   nav, then swap. The module survives DocsAreaGrid's remounts (the panel is
   keyed per dropdown, so the grid unmounts whenever another one opens) by
   living at module scope behind a store, `useSyncExternalStore` rather than
   setState in an effect, which this repo's lint rules refuse.

   Its own module rather than a corner of `nav-panel`, because the header calls
   `loadAnimatedIcons` on the first pointer into the nav and nav-panel is now
   loaded lazily: importing the loader from there would have pulled the panel
   (and `motion/react` with it) straight back into the first-load bundle. */
type AnimatedIconRenderer = typeof AnimatedIcon;

let animatedIcon: AnimatedIconRenderer | null = null;
let animatedIconPending = false;
const animatedIconListeners = new Set<() => void>();

export function loadAnimatedIcons() {
  // Both entry points fire on pointer events, so this is called repeatedly
  // while the first import is still in flight.
  if (animatedIcon || animatedIconPending) return;
  animatedIconPending = true;
  void import("@/components/ui/animated-icon").then((module) => {
    animatedIcon = module.AnimatedIcon;
    for (const notify of animatedIconListeners) notify();
  });
}

export function useAnimatedIcon() {
  return React.useSyncExternalStore(
    (onChange) => {
      animatedIconListeners.add(onChange);
      return () => {
        animatedIconListeners.delete(onChange);
      };
    },
    () => animatedIcon,
    // The server has no animated module either, so both renders agree.
    () => null
  );
}
