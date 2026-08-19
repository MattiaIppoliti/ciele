"use client";

import { useEffect, useState } from "react";
import {
  PreviewRail,
  type PreviewRailItem,
} from "@/components/motion/preview-rail";

/* Each item's `id` must match a section anchor's `id` in the home page so the
   links jump to it AND the scroll-spy below can highlight the active one. */
const SECTIONS: PreviewRailItem[] = [
  {
    id: "overview",
    label: "Overview",
    href: "#overview",
    description: "AI assistants for your business, above the clouds.",
  },
  {
    id: "preview",
    label: "The app",
    href: "#preview",
    description: "See the console: edit an assistant with a live widget preview.",
  },
  {
    id: "features",
    label: "Features",
    href: "#features",
    description:
      "Grounded answers, publish everywhere, and insights instead of guesswork.",
  },
  {
    id: "contact",
    label: "Contact",
    href: "#contact",
    description: "Request a demo or talk to us about your rollout.",
  },
];

export function HomeSectionRail() {
  const [activeId, setActiveId] = useState(SECTIONS[0]?.id ?? "");

  // Highlight whichever section currently crosses the vertical middle of the
  // marketing scroll container (the page scrolls inside `.home-scene`, not the
  // window, see home-shell.tsx, so the observer roots there).
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".home-scene");
    const targets = SECTIONS.map((section) =>
      document.getElementById(section.id),
    ).filter((element): element is HTMLElement => element !== null);
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const crossing = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
        if (crossing) setActiveId(crossing.target.id);
      },
      { root, rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  return (
    // Fixed to the viewport, vertically centred, desktop-only. The wrapper
    // ignores pointer events so it never blocks clicks over the hero; only the
    // bar column (railClassName) re-enables them, and the preview card floats
    // out to the right non-interactively.
    <div className="pointer-events-none fixed inset-y-0 left-4 z-30 hidden items-center xl:flex">
      <PreviewRail
        items={SECTIONS}
        activeId={activeId}
        onActiveChange={setActiveId}
        className="pointer-events-none w-72"
        railClassName="pointer-events-auto"
      />
    </div>
  );
}
