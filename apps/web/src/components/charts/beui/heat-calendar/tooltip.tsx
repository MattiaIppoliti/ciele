"use client";
// Vendored from beui, trimmed to what Ciele's callers use.
import { type ReactNode, useMemo, useState } from "react";
import { Tooltip } from "@/components/charts/beui/motion/tooltip";
import { cn } from "@/lib/utils";
import { useHeatCalendar } from "./context";

export function HeatCalendarTooltip({
  children,
  className,
}: {
  children: (data: NonNullable<ReturnType<typeof useHeatCalendar>["tooltip"]>) => ReactNode;
  className?: string;
}) {
  const { gridRef, tooltipId, tip, tooltip } = useHeatCalendar();
  const [dismissed, setDismissed] = useState<typeof tip>(null);
  const anchorRef = useMemo(() => ({ get current() {
    return tip ? gridRef.current?.querySelector<HTMLElement>(`[data-heat-cell="${tip.w}-${tip.d}"]`) ?? null : null;
  }}), [gridRef, tip]);
  return (
    <Tooltip
      key={tip ? `${tip.w}-${tip.d}` : "closed"}
      open={tooltip !== null && dismissed !== tip}
      onOpenChange={(open) => { if (!open) setDismissed(tip); }}
      id={tooltipId}
      anchorRef={anchorRef}
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      content={tooltip && children(tooltip)}
    />
  );
}
