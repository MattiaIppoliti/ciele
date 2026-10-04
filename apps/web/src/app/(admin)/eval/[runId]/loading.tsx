import { AnalyticsCard } from "@/components/insights/analytics-card";
import { Skeleton } from "@agent-hub/ui";

export default function EvaluationRunLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-7 px-6 py-8" role="status" aria-busy="true">
      <span className="sr-only">Loading run…</span>
      <div className="space-y-3"><Skeleton className="h-4 w-28" /><Skeleton className="h-9 w-80 max-w-full" /><Skeleton className="h-4 w-64" /></div>
      <div className="grid gap-3 md:grid-cols-3">{[0, 1, 2].map((index) => <AnalyticsCard key={index} title={<Skeleton className="h-4 w-28" />} description={<Skeleton className="h-3 w-40" />}><Skeleton className="h-20 w-full" /></AnalyticsCard>)}</div>
      <Skeleton className="h-72 w-full rounded-xl" />
      <Skeleton className="h-80 w-full rounded-xl" />
    </div>
  );
}
