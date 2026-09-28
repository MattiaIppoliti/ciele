import { Skeleton } from "@agent-hub/ui";

/**
 * Section-level streaming boundary for Insights. Placed inside
 * insights/layout.tsx, so the pill rail above it stays painted and only the
 * content column streams. Mirrors insights-client.tsx: header toolbar,
 * date-range chip, then the 12-column metric-card grid and the two full-width
 * charts, with the page's own `px-4 sm:px-6` gutters and `gap-3 sm:gap-4`.
 *
 * Keep this in sync with insights-client.tsx: if the header controls or
 * the metric-card grid change, update the skeleton to match (see
 * docs/ui-loading-states.md).
 */
export default function InsightsLoading() {
  return (
    <div className="flex min-h-full flex-col" role="status" aria-busy="true">
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading insights…</span>
      {/* Header toolbar */}
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-4 pt-5 pb-3 sm:px-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-5 w-full sm:w-52" />
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:flex-nowrap">
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-24" />
        </div>
      </header>

      {/* Date range chip */}
      <div className="shrink-0 px-4 pb-4 sm:px-6">
        <Skeleton className="h-8 w-72 rounded-lg" />
      </div>

      {/* Metric-card grid, the same col-spans insights-client uses */}
      <div className="grid grid-cols-12 gap-3 border-t px-4 pt-5 pb-6 sm:gap-4 sm:px-6">
        {/* Six headline cards, two per row until xl */}
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={`r1-${i}`} className="col-span-6 h-40 rounded-xl xl:col-span-3" />
        ))}
        {/* Four third-width cards (languages, answers, users, ...) */}
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton
            key={`r2-${i}`}
            className="col-span-12 h-40 rounded-xl sm:col-span-6 xl:col-span-4"
          />
        ))}
        {/* Four quarter-width ratio cards */}
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton
            key={`r3-${i}`}
            className="col-span-12 h-40 rounded-xl sm:col-span-6 xl:col-span-3"
          />
        ))}
        {/* Conversation depth */}
        <Skeleton className="col-span-12 h-[22rem] rounded-xl" />
        {/* Usage chart */}
        <Skeleton className="col-span-12 h-80 rounded-xl" />
      </div>
    </div>
  );
}
