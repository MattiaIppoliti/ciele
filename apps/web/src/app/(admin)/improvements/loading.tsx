import { Skeleton } from "@agent-hub/ui";

const LANES = ["To do", "In Progress", "In Review", "Done", "Archived"];

/**
 * Mirrors the Improvements list view (the default), measured against the
 * rendered board once its title had finished rolling in: the title, the
 * toolbar (search, Filters, Export, the list/Kanban toggle, all 37px) pushed
 * right from `sm`, then full-width lanes, each a 37px header bar over its rows.
 */
export default function ImprovementsLoading() {
  return (
    <div className="flex h-full flex-col" role="status" aria-busy="true">
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading improvements…</span>
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-4 pt-5 pb-3 sm:px-6">
        <Skeleton className="h-8 w-38" />
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <Skeleton className="h-10 w-64 max-w-full" />
          <Skeleton className="h-10 w-23" />
          <Skeleton className="h-10 w-13.5" />
          <Skeleton className="h-10 w-19.5" />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto border-t px-4 py-4 sm:px-6">
        <div className="space-y-3">
          {LANES.map((lane) => (
            <div key={lane} className="overflow-hidden rounded-xl border">
              <div className="bg-muted/40 flex h-10 items-center px-4">
                <Skeleton className="h-5 w-24" />
              </div>
              <div className="p-3">
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
