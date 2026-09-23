import { Skeleton } from "@agent-hub/ui";

/**
 * The Document route's boundary (#928): heading, tabs and the two columns, so
 * the click that opened a Document lands on the shape it is about to become.
 */
export function DocumentSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-busy="true">
      <header className="shrink-0 px-6 pt-5 pb-3">
        <Skeleton className="mb-3 h-4 w-48" />
        <Skeleton className="h-8 w-80" />
      </header>
      <div className="grid min-h-0 flex-1 items-start gap-5 px-6 pt-2 pb-6 @2xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="bg-card rounded-xl border">
          <div className="flex gap-4 border-b px-4 py-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="space-y-2.5 p-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-3"
                style={{ width: `${95 - i * 4}%` }}
              />
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div className="bg-card rounded-xl border">
            <div className="border-b px-4 py-3">
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="space-y-5 px-4 py-4">
              {Array.from({ length: 3 }).map((_, group) => (
                <div key={group} className="space-y-2">
                  <Skeleton className="h-3 w-20" />
                  {Array.from({ length: 3 }).map((_, row) => (
                    <div key={row} className="flex justify-between gap-3">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="bg-card rounded-xl border">
            <div className="border-b px-4 py-3">
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="space-y-2 p-4">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
