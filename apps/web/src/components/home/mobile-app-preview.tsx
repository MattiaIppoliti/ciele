"use client";

import { useEffect, useRef, useState } from "react";
import { HomeAppPreview } from "@/components/home/app-preview";
import {
  AmbientActiveContext,
  useShouldAnimate,
} from "@/components/home/use-in-viewport";

/* Compact mock dimensions — must match HomeAppPreview's compact shell. */
const MOCK_W = 560;
const MOCK_H = 480;

/* Mobile hero preview: the live dashboard mock (same idle 1.5s view
   cycling as desktop) rendered in compact mode and scaled to fill the
   phone's width. The wrapper keeps the mock's aspect ratio; the inner
   fixed-size mock is scaled from its top-left corner so the composition
   stays anchored on the sidebar + header area. */
export function MobileAppPreview() {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  // The aspect-ratio box is not transformed (only the inner mock is scaled),
  // so it's a reliable viewport target — gate the mock's idle cycling on it.
  const active = useShouldAnimate(ref);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / MOCK_W);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-xl"
      style={{ aspectRatio: `${MOCK_W} / ${MOCK_H}` }}
    >
      <div
        style={{
          width: MOCK_W,
          height: MOCK_H,
          transform: `scale(${scale || 1})`,
          transformOrigin: "top left",
          visibility: scale ? "visible" : "hidden",
        }}
      >
        <AmbientActiveContext.Provider value={active}>
          <HomeAppPreview compact />
        </AmbientActiveContext.Provider>
      </div>
    </div>
  );
}
