import { Skeleton } from "@agent-hub/ui";

export default function InboxLoading() {
  return (
    <div className="flex h-full flex-col" aria-busy="true">
      <header className="flex shrink-0 flex-col gap-3 px-6 pt-5 pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="ml-auto h-9 w-24" />
        </div>
        <Skeleton className="h-8 w-72" />
      </header>
      <div className="flex min-h-0 flex-1 border-t">
        <aside className="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto border-r p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border px-3 py-3">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </aside>
        <div className="flex flex-1 items-center justify-center" />
      </div>
    </div>
  );
}
