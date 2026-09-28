import { Skeleton } from "@agent-hub/ui";

/**
 * Mirrors one group thread: the back-link and name bar, then the transcript in
 * a centred `max-w-3xl` column. The shared `list` variant was a full-width
 * stack of cards with a page title, neither of which the thread has.
 */
export default function InboxChannelLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden" role="status" aria-busy="true">
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading group…</span>
      <div className="flex shrink-0 items-center gap-3 border-b px-6 py-3">
        <Skeleton className="h-4 w-16" />
        <div className="ml-2 flex items-center gap-2">
          <Skeleton className="size-4 shrink-0" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3 w-52" />
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-4" style={{ width: `${85 - i * 12}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
