"use client";
// beui.dev/charts/heat-calendar, trimmed to what Ciele's callers use.

import { cn } from "@/lib/utils";
import { HeatCalendarContext, useHeatCalendarModel } from "./heat-calendar/context";
import type { HeatCalendarProps } from "./heat-calendar/types";

/** Compose Grid, Tooltip and Legend as children. */
export function HeatCalendar({ children, className, ...props }: HeatCalendarProps) {
  const model = useHeatCalendarModel(props);
  return (
    <HeatCalendarContext.Provider value={model}>
      <div className={cn("w-fit max-w-full", className)}>{children}</div>
    </HeatCalendarContext.Provider>
  );
}

export { HeatCalendarGrid } from "./heat-calendar/grid";
export { HeatCalendarLegend } from "./heat-calendar/legend";
export { HeatCalendarTooltip } from "./heat-calendar/tooltip";
