import { Skeleton } from "@agent-hub/ui";

/**
 * One Library tab's content, below the header the layout keeps painted (title,
 * tab rail, intro). Mirrors KnowledgeHubClient: the toolbar (search, then
 * Export / Import / Add pushed right) over the sources table. No title of its
 * own: the shared list skeleton drew one, so the tab showed two headings.
 */
export default function LibraryTabLoading() {
  return (
    <div className="min-h-0 flex-1 space-y-4 px-4 py-4 sm:px-6" role="status" aria-busy="true">
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading sources…</span>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-72" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-22" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border">
        <Skeleton className="h-10 w-full rounded-none" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-t px-4 py-3">
            <Skeleton className="size-4 shrink-0" />
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-4 w-1/5" />
            <Skeleton className="ml-auto h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
