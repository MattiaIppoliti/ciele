// Vendored from EvilCharts, trimmed to what Ciele's callers use.
import { getPayloadConfigFromPayload, getColorsCount, useChart } from "@/components/charts/evilcharts/ui/recharts-chart";
import { indicatorBackground } from "@/components/charts/evilcharts/ui/chart-colors";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import * as RechartsPrimitive from "recharts";
import { cn } from "@/lib/utils";
import type * as React from "react";

/** The label-less, dot-indicator tooltip body the pie chart renders. */
function ChartTooltipContent({
  active,
  payload,
  className,
  formatter,
  nameKey,
}: React.ComponentProps<typeof RechartsPrimitive.Tooltip> &
  React.ComponentProps<"div"> & {
    nameKey?: string;
  } & Omit<
    RechartsPrimitive.DefaultTooltipContentProps<ValueType, NameType>,
    "accessibilityLayer"
  >) {
  const { config } = useChart();

  if (!active || !payload?.length) {
    // Empty tooltip - to prevent position getting 0.0 so it doesnt animate tooltip every time from 0.0 origin
    return <span className="p-4" />;
  }

  return (
    <div
      className={cn(
        "border-border/50 grid min-w-32 items-start gap-1.5 border px-2.5 py-1.5 text-xs shadow-xl",
        "rounded-lg bg-background",
        className,
      )}
    >
      <div className="grid gap-1.5">
        {payload
          .filter((item) => item.type !== "none")
          .map((item, index) => {
            // For pie charts the sector name is in item.payload[nameKey]; for
            // other charts, item.name or item.dataKey holds the series name.
            const payloadName =
              nameKey && item.payload
                ? (item.payload as Record<string, unknown>)[nameKey]
                : undefined;
            const key = `${payloadName ?? item.name ?? item.dataKey ?? "value"}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);

            // Get colors count for this item to determine gradient vs solid
            const colorsCount = itemConfig ? getColorsCount(itemConfig) : 1;

            return (
              <div
                key={index}
                className="[&>svg]:text-muted-foreground flex w-full flex-wrap gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 items-center"
              >
                {formatter && item?.value !== undefined && item.name ? (
                  formatter(item.value, item.name, item, index, item.payload)
                ) : (
                  <>
                    {itemConfig?.icon ? (
                      <itemConfig.icon />
                    ) : (
                      <div
                        className="shrink-0 rounded-[2px] h-2.5 w-2.5"
                        style={{ background: indicatorBackground(key, colorsCount) }}
                      />
                    )}
                    <div className="flex flex-1 justify-between gap-4 leading-none items-center">
                      <div className="grid gap-1.5">
                        <span className="text-muted-foreground">
                          {itemConfig?.label ?? item.name}
                        </span>
                      </div>
                      {item.value != null && (
                        <span className="text-foreground font-mono font-medium tabular-nums">
                          {typeof item.value === "number"
                            ? item.value.toLocaleString()
                            : String(item.value)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

const ChartTooltip = ({
  animationDuration = 200,
  ...props
}: React.ComponentProps<typeof RechartsPrimitive.Tooltip>) => (
  <RechartsPrimitive.Tooltip animationDuration={animationDuration} {...props} />
);

export { ChartTooltip, ChartTooltipContent };
