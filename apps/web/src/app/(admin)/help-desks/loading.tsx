import { Skeleton } from "@agent-hub/ui";

export default function HelpDesksLoading() {
  return (
    <div className="flex h-full flex-col overflow-y-auto" role="status" aria-busy="true">
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading help desks…</span>
      <div className="overview-panels grid grid-cols-1 gap-6 border-t px-6 py-6 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="overview-card flex min-w-0 flex-col">
            <div className="overview-card-content min-h-32 flex-1 space-y-1.5 p-5">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
              <div className="flex min-w-0 flex-1 basis-36 items-center gap-3">
                <Skeleton className="size-9 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-36 max-w-full" />
              </div>
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
