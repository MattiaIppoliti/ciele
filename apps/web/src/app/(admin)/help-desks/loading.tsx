import { Skeleton } from "@agent-hub/ui";

export default function HelpDesksLoading() {
  return (
    <div className="flex h-full flex-col overflow-y-auto" role="status" aria-busy="true">
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading help desks…</span>
      <header className="flex shrink-0 items-center gap-3 px-6 pt-5 pb-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="ml-auto h-10 w-32 rounded-lg" />
      </header>
      <div className="grid grid-cols-1 gap-4 border-t px-6 py-6 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          // The card's own contents: a text-lg title, the three-line clamped
          // description and the h-10 "Manage Desk" button.
          <div key={i} className="flex flex-col gap-3 rounded-xl border p-4">
            <Skeleton className="h-6 w-40" />
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-2/3" />
            </div>
            <Skeleton className="mt-auto h-10 w-32 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
