import { Skeleton } from "@agent-hub/ui";

export default function HelpDesksLoading() {
  return (
    <div className="flex h-full flex-col overflow-y-auto" aria-busy="true">
      <header className="flex shrink-0 items-center gap-3 px-6 pt-5 pb-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="ml-auto h-9 w-32" />
      </header>
      <div className="grid grid-cols-1 gap-4 border-t px-6 py-6 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-xl border p-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-8 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
