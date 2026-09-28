import { Skeleton } from "@agent-hub/ui";

/**
 * Mirrors the Groups oversight list: heading with the Conversations link at
 * the right, the blurb, then full-bleed divided rows. The shared `list`
 * variant draws bordered cards inside a padded frame, which this page does not
 * have.
 */
export default function InboxChannelsLoading() {
  return (
    <div className="flex h-full flex-col overflow-y-auto" role="status" aria-busy="true">
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading groups…</span>
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-6 pt-5 pb-3">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="ml-auto h-5 w-24" />
      </header>
      <div className="px-6 pb-4">
        <Skeleton className="h-5 w-full max-w-lg" />
      </div>
      <ul className="divide-y border-t">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="flex items-center gap-3 px-6 py-3">
            <Skeleton className="size-4 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-2/3" />
            </div>
            <Skeleton className="h-3 w-16 shrink-0" />
          </li>
        ))}
      </ul>
    </div>
  );
}
