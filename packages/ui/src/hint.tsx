"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./tooltip";

/**
 * Hover label for icon-only buttons. Wraps the child in a span trigger so
 * it composes with dropdown/menu triggers without nesting buttons.
 */
export function Hint({
  label,
  side = "bottom",
  children,
}: {
  label: string;
  side?: "top" | "bottom" | "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
