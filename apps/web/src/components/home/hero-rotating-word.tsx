"use client";

import React from "react";
import dynamic from "next/dynamic";
import type { ChromaticTextRevealProps } from "@/components/motion/text-animation";

/* The headline's rotating word is the public site's only above-the-fold use of
   `motion/react`, and that library was the heaviest single thing every
   marketing page downloaded before it could show anything. So the word is
   server-rendered in its resting state, exactly where and how the animation
   leaves it, and the animated version is fetched after hydration and swapped in.

   Nothing moves in the swap: the fallback is the same inline-grid, sized by the
   same invisible copies of every word, so the headline's line breaks and the
   ghost beside it are settled before any JavaScript arrives. What a visitor
   loses if the module is slow (or never arrives) is the sweep, not the
   sentence. */
const ChromaticTextReveal = dynamic(
  () =>
    import("@/components/motion/text-animation").then(
      (m) => m.ChromaticTextReveal
    ),
  { ssr: false, loading: () => null }
);

/* One flag for the page: the swap is a render-once affair, and a module-scope
   store keeps it out of an effect's setState, which this repo's lint rules
   refuse (see nav-panel for the same pattern). */
let armed = false;
const listeners = new Set<() => void>();

function arm() {
  if (armed) return;
  armed = true;
  for (const notify of listeners) notify();
}

function useArmed() {
  React.useEffect(arm, []);

  return React.useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    () => armed,
    // The server renders the resting word, never the animation.
    () => false
  );
}

/** The word that rotates under the hero's chromatic sweep, animated or not. */
export function HeroRotatingWord(props: ChromaticTextRevealProps) {
  const ready = useArmed();
  const { words, suffix = "", className, foregroundColor } = props;

  if (ready) return <ChromaticTextReveal {...props} />;

  return (
    <span className={`relative inline-grid ${className ?? ""}`}>
      {Array.from(new Set(words)).map((word, index) => (
        <span
          key={word}
          aria-hidden={index > 0}
          className={`col-start-1 row-start-1 whitespace-nowrap${
            index > 0 ? " invisible" : ""
          }`}
          style={
            index === 0 && foregroundColor
              ? { color: foregroundColor }
              : undefined
          }
        >
          {word}
          {suffix}
        </span>
      ))}
    </span>
  );
}
