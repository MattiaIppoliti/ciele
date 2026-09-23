import { Skeleton } from "@agent-hub/ui";

/**
 * The Documents route's own boundary (#927), rather than the shared `list`
 * skeleton: this page opens on a header the reader is already looking at (they
 * clicked the Source's name), so drawing the breadcrumb, the title and an
 * empty table keeps the click connected to what arrives.
 */
export function SourceDocumentsSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-busy="true">
      <header className="shrink-0 px-6 pt-5 pb-4">
        <Skeleton className="mb-3 h-4 w-40" />
        <Skeleton className="h-8 w-72" />
        <div className="mt-2 flex items-center gap-2">
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-4 w-32" />
        </div>
      </header>
      <div className="min-h-0 flex-1 px-6 pb-6">
        <Skeleton className="mb-2 h-3 w-28" />
        <div className="bg-card divide-y rounded-xl border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="size-4 shrink-0 rounded" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-56" />
                <Skeleton className="h-3 w-80" />
              </div>
              <Skeleton className="h-4 w-8 shrink-0" />
              <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
              <Skeleton className="h-3 w-24 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
