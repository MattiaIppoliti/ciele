"use client";

import { Cell, Pie, PieChart } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-hub/ui";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

/**
 * The Usage tab's two donuts: where the credits went (by metered resource) and
 * who paid for them (the platform's plan vs the organization's own
 * credentials). Both read the same fold as the numbers below them
 * (`summarizeUsage`), so a ring and a table can never disagree.
 */
export interface UsageSlice {
  key: string;
  label: string;
  credits: number;
}

/**
 * Explicit hues rather than the theme's `--chart-*` variables: those are a
 * greyscale ramp, which reads fine as stacked areas but turns a donut's darker
 * slices invisible against the card. Same palette as the Insights series, so
 * the two analytics surfaces stay one visual language.
 */
const COLORS = ["#2563eb", "#059669", "#ea580c", "#a855f7", "#0891b2"];

function configFor(slices: UsageSlice[]): ChartConfig {
  return Object.fromEntries(
    slices.map((slice, index) => [
      slice.key,
      { label: slice.label, color: COLORS[index % COLORS.length] },
    ])
  );
}

/** Credits as the rings label them, one decimal below 100, none above. */
function formatCredits(credits: number): string {
  if (credits === 0) return "0";
  if (credits < 0.1) return "<0.1";
  return credits.toLocaleString("en-US", {
    maximumFractionDigits: credits < 100 ? 1 : 0,
  });
}

function Donut({
  title,
  description,
  slices,
}: {
  title: string;
  description: string;
  slices: UsageSlice[];
}) {
  const total = slices.reduce((sum, slice) => sum + slice.credits, 0);
  const config = configFor(slices);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          // An empty ring would read as a real split of nothing.
          <p className="text-muted-foreground py-8 text-sm">
            Nothing to split yet, this fills in as soon as an assistant answers,
            indexes knowledge, or crawls a page.
          </p>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <ChartContainer
              config={config}
              className="aspect-square h-32 w-32 shrink-0"
            >
              <PieChart>
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      nameKey="key"
                      formatter={(value) => `${formatCredits(Number(value))} credits`}
                    />
                  }
                />
                <Pie
                  data={slices}
                  dataKey="credits"
                  nameKey="key"
                  innerRadius="58%"
                  outerRadius="100%"
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {slices.map((slice, index) => (
                    <Cell
                      key={slice.key}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            {/* Legend under the ring, not beside it: these cards sit two-up
                inside the dialog, where a side legend truncates every label. */}
            <ul className="w-full space-y-1.5 text-sm">
              {slices.map((slice, index) => (
                <li key={slice.key} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: COLORS[index % COLORS.length] }}
                  />
                  <span className="min-w-0 flex-1 truncate">{slice.label}</span>
                  <span className="shrink-0 tabular-nums">
                    {Math.round((slice.credits / total) * 100)}%
                  </span>
                  <span className="text-muted-foreground w-14 shrink-0 text-right tabular-nums">
                    {formatCredits(slice.credits)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function UsagePies({
  byResource,
  byFunding,
}: {
  byResource: UsageSlice[];
  byFunding: UsageSlice[];
}) {
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <Donut
        title="Credits by resource"
        description="Answering, indexing, and crawling, priced through one conversion."
        slices={byResource}
      />
      <Donut
        title="Who funded the work"
        description="Only platform-funded credits count against a plan."
        slices={byFunding}
      />
    </div>
  );
}
