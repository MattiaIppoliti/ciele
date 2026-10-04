"use client";

import { RollInText } from "@/components/motion/roll-in-text";

import { Gauge, GaugeMarks, GaugeStack, GaugeText } from "@/components/gauge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-hub/ui";
import { formatCredits } from "@/lib/usage-summary";

const SHADES = [1, 0.55, 0.3];

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
  const percent = (slice: UsageSlice) =>
    Math.round((slice.credits / total) * 100);

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
            <div
              role="img"
              aria-label={`${title}: ${formatCredits(total)} credits. ${slices.map((slice) => `${slice.label}: ${formatCredits(slice.credits)} credits, ${percent(slice)}%`).join(". ")}`}
              className="size-36 text-foreground"
            >
              <Gauge value={100} startAngle={180} endAngle={540} padding={24} aria-hidden="true">
                <GaugeStack
                  width={32}
                  parts={slices.map((slice, index) => ({
                    weight: slice.credits,
                    color: "currentColor",
                    opacity: SHADES[index % SHADES.length],
                  }))}
                />
                <GaugeMarks
                  values={slices.map((_, index) => (slices.slice(0, index + 1).reduce((sum, slice) => sum + slice.credits, 0) / total) * 100)}
                  length={36}
                  width={6}
                  color="var(--card)"
                />
                <GaugeText fontSize={82} weight="semibold" className="tabular-nums">{formatCredits(total)}</GaugeText>
                <GaugeText y={62} fontSize={32} color="var(--muted-foreground)">credits</GaugeText>
              </Gauge>
            </div>
            {/* Legend under the ring, not beside it: these cards sit two-up
                inside the dialog, where a side legend truncates every label. */}
            <ul className="w-full space-y-1.5 text-sm">
              {slices.map((slice, index) => (
                <li key={slice.key} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full bg-foreground"
                    style={{ opacity: SHADES[index % SHADES.length] }}
                  />
                  <span className="min-w-0 flex-1 truncate">{slice.label}</span>
                  <span className="shrink-0 tabular-nums">
                    {percent(slice)}%
                  </span>
                  <span className="text-muted-foreground w-14 shrink-0 text-right tabular-nums">
                    <RollInText text={formatCredits(slice.credits)} />
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
    <div className="mt-4 grid gap-4 @md/settings:grid-cols-2">
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
