import { Skeleton } from "@agent-hub/ui";

export default function ExportsLoading() {
  return (
    <div className="flex h-full flex-col" aria-busy="true">
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-6 pt-5 pb-3">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="ml-auto h-10 w-32" />
      </header>
      <div className="px-6">
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="divide-border overflow-hidden rounded-xl border divide-y">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Skeleton className="size-5 shrink-0 rounded" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ml-auto h-6 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
