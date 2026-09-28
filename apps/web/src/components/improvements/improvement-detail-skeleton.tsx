import { Skeleton } from "@agent-hub/ui";

/**
 * The shape of `ImprovementDetail`, shared by the three places it loads: the
 * `/improvements/[improvementId]` route boundary, the drawer while its chunk
 * arrives, and the drawer while it fetches the record. Measured against the
 * rendered detail: key badge, 29px title and meta line (the page adds the
 * breadcrumb above them), then the description, the Associated Messages card
 * and, from the `@5xl` container width, the 320px properties rail beside them
 * (below them in a narrow drawer).
 */
export function ImprovementDetailSkeleton({ variant }: { variant: "page" | "drawer" }) {
  return (
    <div className="@container flex h-full flex-col overflow-y-auto" aria-hidden>
      <header className="shrink-0 px-6 pt-5 pb-4">
        {variant === "page" && <Skeleton className="mb-3 h-5 w-44" />}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-6.5 w-14 rounded-md" />
            <Skeleton className="mt-1 h-8 w-2/3" />
            <Skeleton className="mt-1 h-4 w-40" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="size-8" />
          </div>
        </div>
      </header>
      <div className="@5xl:grid-cols-[1fr_320px] grid flex-1 gap-6 border-t px-6 py-5">
        <div className="min-w-0 space-y-6">
          <Skeleton className="h-20 w-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-5 w-3/4" />
          </div>
          <div className="overflow-hidden rounded-xl border">
            <Skeleton className="h-10 w-full rounded-none" />
            <div className="space-y-2.5 p-4">
              <Skeleton className="ml-auto h-8 w-1/2 rounded-2xl" />
              <Skeleton className="h-20 w-4/5" />
              <Skeleton className="ml-auto h-8 w-2/5 rounded-2xl" />
              <Skeleton className="h-24 w-4/5" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border px-4 py-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex h-10.5 items-center justify-between gap-3">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
