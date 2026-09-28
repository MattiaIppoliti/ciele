import { Skeleton } from "@agent-hub/ui";

/**
 * Mirrors alerts-list.tsx, measured against a production build: the title,
 * the blurb, the 37px tab bar, then the table card. Below `lg` each alert
 * stacks into a ~150px card (issue, times, status, actions); from `lg` it is
 * one grid row under a column header.
 */
export default function AlertsLoading() {
  return (
    <div className="flex h-full flex-col" role="status" aria-busy="true">
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading alerts…</span>
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-4 pt-5 pb-3 sm:px-6">
        <Skeleton className="h-8 w-24" />
      </header>
      <div className="px-4 sm:px-6">
        <Skeleton className="h-5 w-full max-w-xl" />
      </div>
      <div className="mt-4 px-4 sm:px-6">
        <Skeleton className="h-10 w-80 max-w-full rounded-lg" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="overflow-hidden rounded-xl border">
          <Skeleton className="hidden h-8 w-full rounded-none lg:block" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 border-t px-4 py-3 first:border-t-0 lg:flex-row lg:items-center lg:gap-3"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-5 w-64 max-w-full" />
                <Skeleton className="h-4 w-full max-w-md" />
              </div>
              <div className="flex gap-4 lg:contents">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="h-6 w-20 rounded-full" />
              <div className="flex gap-2">
                <Skeleton className="h-8 w-28" />
                <Skeleton className="h-8 w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
