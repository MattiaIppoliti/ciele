import { Skeleton } from "@agent-hub/ui";

/**
 * The Assistant Overview's streaming boundary. Every SETUP section has its
 * own, so this one only ever stands in for the Overview and mirrors
 * assistant-overview.tsx: the status card, the Setup / Activity / Quality
 * row, Flows beside Knowledge, then Recent conversations.
 */
export default function AssistantOverviewLoading() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8 sm:py-8" aria-busy="true">
      <Skeleton className="h-80 rounded-xl" />
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={`row-${i}`} className="h-64 rounded-xl" />
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <Skeleton className="mt-6 h-72 rounded-xl" />
    </div>
  );
}
