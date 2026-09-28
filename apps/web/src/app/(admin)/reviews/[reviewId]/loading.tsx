import { Skeleton } from "@agent-hub/ui";

/**
 * Mirrors `ReviewDecision`: a centred column (eyebrow, title, meta line) over
 * the message card and the decision card. The generic form skeleton sat
 * left-aligned with a header button this page never shows, so the content
 * jumped sideways when it arrived.
 */
export default function ReviewLoading() {
  return (
    <div
      className="mx-auto max-w-2xl space-y-4 px-4 py-6 sm:px-5"
      role="status"
      aria-busy="true"
    >
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading review…</span>
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="space-y-2 rounded-xl border p-4">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-4/5" />
      </div>
      <div className="space-y-4 rounded-xl border p-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
    </div>
  );
}
