import { Skeleton } from "@agent-hub/ui";

/**
 * The Teammates thread pane while a route loads, beside the rail the layout
 * keeps painted. A Teammate opens on the empty hero, before its first message;
 * only a channel opens on a transcript. Match those workspaces rather than
 * showing conversation bubbles while an empty chat is arriving.
 */
export function ThreadSkeleton({ variant }: { variant: "teammate" | "channel" | "settings" }) {
  if (variant === "teammate") {
    return (
      <div className="flex h-full flex-col overflow-hidden" role="status" aria-busy="true">
        <span className="sr-only">Loading…</span>
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 py-4 sm:px-5">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex flex-1 flex-col items-center justify-end gap-4 px-4 pb-6 text-center">
              <Skeleton className="size-16 shrink-0 rounded-full" />
              <Skeleton className="h-9 w-80 max-w-full" />
            </div>
            <div className="px-4 pb-4">
              <Skeleton className="h-24 w-full rounded-2xl" />
            </div>
            <div className="flex-1" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" role="status" aria-busy="true">
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading…</span>
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
            className="bg-card flex min-h-0 flex-1 flex-col rounded-xl border"
          >
            <div className="flex-1" />
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
