import { Skeleton } from "@agent-hub/ui";

export default function MembersLoading() {
  return (
    <div className="h-full overflow-y-auto" aria-busy="true">
      <div className="mx-auto max-w-4xl px-8 py-8">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-4 h-8 w-40" />
        <Skeleton className="mt-2 h-4 w-64" />
        <div className="mt-8 rounded-xl border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b px-5 py-4 last:border-b-0"
            >
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-8 w-20 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
