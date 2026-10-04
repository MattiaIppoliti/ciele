"use client";

import { lazy, Suspense } from "react";

const TextMorph = lazy(() => import("torph/react").then(module => ({ default: module.TextMorph })));

/** Plain text on the server and while loading; Torph owns subsequent changes. */
export function MorphText({ text, className, duration = 380 }: { text: string; className?: string; duration?: number }) {
  return <Suspense fallback={<span className={className}>{text}</span>}>
    <TextMorph className={className} duration={duration} scale={false} respectReducedMotion>{text}</TextMorph>
  </Suspense>;
}
