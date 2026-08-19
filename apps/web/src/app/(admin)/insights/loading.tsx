import { Skeleton } from "@agent-hub/ui";

/**
 * Section-level streaming boundary for Insights. Placed inside
 * insights/layout.tsx, so the sub-nav aside (Insights / Trends /
 * Feedback & grading / Exports) stays painted and only this content
 * column streams, the skeleton mirrors the real Insights page: header
 * toolbar, date-range chip, then the 12-column metric-card grid + chart.
 *
 * Keep this in sync with insights-client.tsx: if the header controls or
 * the metric-card grid change, update the skeleton to match (see
 * docs/ui-loading-states.md).
 */
export default function InsightsLoading() {
  return (
    <div className="flex min-h-full flex-col" aria-busy="true">
      {/* Header toolbar */}
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-6 pt-5 pb-3">
        <Skeleton className="h-8 w-32" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-24" />
        </div>
      </header>

      {/* Date range chip */}
      <div className="shrink-0 px-6 pb-4">
        <Skeleton className="h-8 w-72 rounded-lg" />
      </div>

      {/* Metric-card grid, mirrors the col-span layout in insights-client */}
      <div className="grid grid-cols-12 gap-4 border-t px-6 pt-5 pb-6">
        {/* Row 1: four quarter-width cards */}
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton
            key={`r1-${i}`}
            className="col-span-12 h-40 rounded-xl sm:col-span-6 xl:col-span-3"
          />
        ))}
        {/* Row 2: three third-width cards */}
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton
            key={`r2-${i}`}
            className="col-span-12 h-40 rounded-xl sm:col-span-6 xl:col-span-4"
          />
        ))}
        {/* Rows 3–4: half-width cards */}
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton
            key={`r3-${i}`}
            className="col-span-12 h-40 rounded-xl xl:col-span-6"
          />
        ))}
        {/* Usage chart */}
        <Skeleton className="col-span-12 h-80 rounded-xl" />
      </div>
    </div>
  );
}
