import { AnalyticsCard } from "../analytics-card";
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
      <div className="space-y-4 px-4 pt-5 pb-8 sm:px-6">
        <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
          {Array.from({ length: statRows * 2 }).map((_, i) => (
            <AnalyticsCard key={`stat-${i}`} title={<Skeleton className="h-4 w-28" />} description={<Skeleton className="h-3 w-36" />} action={<Skeleton className="h-7 w-16 rounded-full" />}><Skeleton className="h-28 w-full" /></AnalyticsCard>
          ))}
        </div>
        <AnalyticsCard title={<Skeleton className="h-4 w-40" />} description={<Skeleton className="h-3 w-60" />}><Skeleton className="h-72 w-full" /></AnalyticsCard>
        <div className="grid grid-cols-12 gap-4">
          <Skeleton className="col-span-12 h-[34rem] rounded-xl @5xl:col-span-5" />
          <Skeleton className="col-span-12 h-[34rem] rounded-xl @5xl:col-span-7" />
        </div>
      </div>
    </div>
  );
}
