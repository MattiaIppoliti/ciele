import { Skeleton } from "@agent-hub/ui";

export default function AlertsLoading() {
  return (
    <div className="flex h-full flex-col" aria-busy="true">
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-6 pt-5 pb-3">
        <Skeleton className="h-7 w-24" />
      </header>
      <div className="px-6">
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="mt-4 flex items-center gap-4 border-b px-6 pb-2">
        <Skeleton className="h-5 w-8" />
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-5 w-20" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="overflow-hidden rounded-xl border">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 border-t px-4 py-3 first:border-t-0"
            >
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="ml-auto h-6 w-20 rounded-full" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
