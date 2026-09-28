import { Skeleton } from "@agent-hub/ui";

/**
 * The Assistant Overview's streaming boundary. Every SETUP section has its
 * own, so this one only ever stands in for the Overview and mirrors
 * assistant-overview.tsx: the status card, the Setup / Activity / Quality
 * row, Flows beside Knowledge, then Recent conversations.
 */
export default function AssistantOverviewLoading() {
  return (
    <div
      className="mx-auto max-w-6xl px-5 py-6 sm:px-8 sm:py-8"
      role="status"
      aria-busy="true"
    >
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading assistant…</span>
      {/* Heights measured on the demo Overview (production build): the status
          card, Setup / Activity / Quality, Flows beside Knowledge, Recent
          conversations. They follow data, so these are typical, not exact. */}
      <Skeleton className="h-124 rounded-xl" />
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-44.5 rounded-xl" />
        <Skeleton className="h-94.5 rounded-xl" />
        <Skeleton className="h-57 rounded-xl" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64.5 rounded-xl" />
        <Skeleton className="h-42 rounded-xl" />
      </div>
      <Skeleton className="mt-6 h-29.5 rounded-xl" />
    </div>
  );
}
