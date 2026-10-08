"use client";

import { Info } from "lucide-react";
import { Button as CieleButton, Hint } from "@agent-hub/ui";
import { RollInText } from "@/components/motion/roll-in-text";
import { formatRange } from "./date-range-dropdown";

export function InsightsRangeChip({ from, to, hint }: {
  from: string;
  to: string;
  hint: string;
}) {
  return (
    <span className="text-primary border-primary/20 bg-primary/5 dark:border-primary/40 dark:bg-primary/15 inline-flex h-9 min-w-0 max-w-full items-center gap-1.5 rounded-lg border px-3 text-sm font-medium whitespace-nowrap">
      <span className="shrink-0">Date Range:</span>
      <RollInText text={formatRange(from, to)} className="min-w-0 truncate" />
      <Hint label={hint}>
        <CieleButton variant="ghost" size="icon-sm" type="button" aria-label="About this range" className="press-control focus-visible:outline-ring inline-flex shrink-0 rounded-sm hover:opacity-70 focus-visible:outline-2">
          <Info className="size-3.5" aria-hidden />
        </CieleButton>
      </Hint>
    </span>
  );
}
