import { Skeleton } from "@agent-hub/ui";

/**
 * Mirrors inbox-client.tsx, measured against a production build: the header
 * (title, search and the two 37px buttons pushed right from
 * `sm`), the date-range chip in its own row, then the conversation log, which
 * owns the full width below `lg` and is the 18rem left pane above it, beside
 * the thread.
 */
export default function InboxLoading() {
  return (
    <div className="flex h-full flex-col" role="status" aria-busy="true">
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading conversations…</span>
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-4 pt-5 pb-3 sm:px-6">
        <Skeleton className="h-8 w-20" />
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <Skeleton className="h-10 min-w-0 flex-1 sm:w-64 sm:flex-none" />
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-26" />
        </div>
      </header>
      <div className="shrink-0 px-4 pb-3 sm:px-6">
        <Skeleton className="h-8.5 w-80 max-w-full rounded-lg" />
      </div>
      <div className="flex min-h-0 flex-1 border-t">
        <aside className="flex w-full shrink-0 flex-col overflow-y-auto border-r lg:w-72">
          <div className="flex items-center gap-2 px-4 py-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-4" />
          </div>
          <Skeleton className="mx-4 mb-2 h-4 w-28" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3 border-b px-4 py-3">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-16" />
              </div>
            </div>
          ))}
        </aside>
        <div className="hidden flex-1 lg:block" />
      </div>
    </div>
  );
}
