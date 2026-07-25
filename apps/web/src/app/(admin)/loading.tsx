import { Skeleton } from "@agent-hub/ui";

/**
 * Streaming boundary for the admin console: the sidebar shell stays
 * interactive and this paints instantly while the destination page's data
 * loads — navigations stop blocking on the database before showing
 * anything.
 */
export default function AdminLoading() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-8" aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-2 h-4 w-80" />
      <div className="mt-8 space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}
