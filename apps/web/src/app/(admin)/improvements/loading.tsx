import { Skeleton } from "@agent-hub/ui";

const LANES = ["To do", "In Progress", "In Review", "Done", "Archived"];

export default function ImprovementsLoading() {
  return (
    <div className="flex h-full flex-col" aria-busy="true">
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-6 pt-5 pb-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="ml-auto h-9 w-28" />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto border-t px-6 py-4">
        <div className="mx-auto max-w-5xl space-y-3">
          {LANES.map((lane) => (
            <div key={lane} className="overflow-hidden rounded-xl border">
              <div className="bg-muted/40 flex items-center gap-2 px-4 py-2.5">
                <Skeleton className="h-4 w-28" />
              </div>
              <div className="space-y-2 p-3">
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
