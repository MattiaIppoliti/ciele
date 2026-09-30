import { Skeleton } from "@agent-hub/ui";

/**
 * The streaming boundary both dashboards share, inside insights/layout.tsx so
 * the pill rail stays painted: the stat cards (two across: four rows
 * on Observability, two on Costs), then a full-width chart and a card pair.
 */
export function DashboardSkeleton({ statRows }: { statRows: 2 | 4 }) {
  return (
    <div className="flex min-h-full flex-col" role="status" aria-busy="true">
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading dashboard…</span>
      <div className="space-y-4 border-t px-4 pt-5 pb-8 sm:px-6">
        <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
          {Array.from({ length: statRows * 2 }).map((_, i) => (
            <Skeleton key={`stat-${i}`} className="h-[106px] rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl" />
        <div className="grid grid-cols-12 gap-4">
          <Skeleton className="col-span-12 h-[34rem] rounded-xl @5xl:col-span-5" />
          <Skeleton className="col-span-12 h-[34rem] rounded-xl @5xl:col-span-7" />
        </div>
      </div>
    </div>
  );
}
