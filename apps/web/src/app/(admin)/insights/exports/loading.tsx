import { Skeleton } from "@agent-hub/ui";

export default function ExportsLoading() {
  return (
    <div className="flex h-full flex-col" role="status" aria-busy="true">
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading exports…</span>
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-4 pt-5 pb-3 sm:px-6">
        <Skeleton className="h-5 w-full max-w-xl flex-1" />
        <Skeleton className="h-10 w-32" />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="divide-border overflow-hidden rounded-xl border divide-y">
          {/* A row is the name over the kind/format and request-time lines. */}
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Skeleton className="size-5 shrink-0 rounded" />
              <div className="min-w-0 flex-1 space-y-1">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-52" />
              </div>
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-8 w-28" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
