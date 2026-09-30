import { Skeleton } from "@agent-hub/ui";

/**
 * The Teammates thread pane while a route loads, beside the rail the layout
 * keeps painted. Built from the workspaces' own classes (the demo has no
 * Teammate to measure against): the border-b header bar (avatar or channel
 * mark, name, subtitle, action) over a centred max-w-3xl column. The shared
 * RouteSkeleton it replaces drew a page title the pane never has.
 */
export function ThreadSkeleton({ variant }: { variant: "teammate" | "channel" | "settings" }) {
  return (
    <div className="flex h-full flex-col overflow-hidden" role="status" aria-busy="true">
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading…</span>
      {variant !== "settings" && (
        <div className="flex shrink-0 items-center gap-3 border-b px-6 py-3">
          {variant === "teammate" ? (
            <Skeleton className="size-8 shrink-0 rounded-full" />
          ) : (
            <Skeleton className="size-4 shrink-0" />
          )}
          <div className="min-w-0 space-y-1.5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3.5 w-52" />
          </div>
          <Skeleton className="ml-auto h-8 w-28" />
        </div>
      )}
      {variant === "settings" ? (
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 py-4 sm:px-5">
          <div
            className={`flex min-h-0 flex-1 flex-col ${variant === "teammate" ? "rounded-xl border" : ""}`}
          >
            <div className="flex-1 space-y-4 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className={`flex gap-3 ${i % 2 ? "justify-end" : ""}`}>
                  {i % 2 === 0 && <Skeleton className="size-8 shrink-0 rounded-full" />}
                  <Skeleton
                    className="h-12 rounded-2xl"
                    style={{ width: `${70 - i * 8}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="p-4">
              <Skeleton className="h-20 w-full rounded-xl" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * `/teammates` itself: Ciele AI's landing, the face, the question and the
 * composer centred on an empty page, at the sizes the hero workspace draws.
 */
export function TeammatesIndexSkeleton() {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-4 px-6"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading…</span>
      <Skeleton className="size-16 rounded-full" />
      <Skeleton className="h-8 w-72 max-w-full" />
      <Skeleton className="mt-2 h-24 w-full max-w-2xl rounded-2xl" />
    </div>
  );
}
