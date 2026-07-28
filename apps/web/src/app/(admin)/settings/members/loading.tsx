import { Skeleton } from "@agent-hub/ui";

/** Members' own loading state, at the Settings dialog's scale. */
export default function MembersLoading() {
  return (
    <div className="mx-auto max-w-2xl pr-6" aria-busy="true">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="mt-2 h-4 w-56" />
      <div className="mt-6 rounded-xl border">
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
  );
}
