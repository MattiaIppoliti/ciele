import React from "react";
import { cn } from "@agent-hub/ui";

/**
 * Blur + rise + fade reveal for the mobile menu items
 * (beui.dev/components/motion/text-animation), driven purely by the nav's open
 * state via CSS (see home.css `.home-reveal`, gated on `nav[data-state=active]`).
 * `delay` staggers each item on open and resets quickly on close so it replays.
 *
 * No hooks and no listeners: the animation is entirely CSS, which is why this
 * is a plain component rather than part of the header's client machinery.
 */
export function Reveal({
  delay,
  className,
  children,
}: {
  delay: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("home-reveal", className)}
      style={{ "--reveal-delay": `${delay}s` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
