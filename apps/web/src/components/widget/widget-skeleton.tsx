import { Skeleton } from "@agent-hub/ui";

/**
 * Loading state for `/widget/[assistantId]`.
 *
 * This route awaits the assistant's latest Publication before it can render
 * anything, and it is the surface an end user sees embedded in someone else's
 * page: an empty frame while that resolves reads as a widget that failed to
 * load. The shape mirrors the real chat, header, transcript, composer, so the
 * frame does not resize when the content arrives.
 */
export function WidgetSkeleton() {
  return (
    <div className="flex h-svh flex-col" aria-busy="true">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-2.5 w-20" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
        {/* One assistant turn, then a visitor turn: enough to establish the
            two alignments without pretending to know the transcript. */}
        <div className="space-y-2">
          <Skeleton className="h-3 w-[70%]" />
          <Skeleton className="h-3 w-[85%]" />
          <Skeleton className="h-3 w-[45%]" />
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-9 w-[55%] rounded-2xl" />
        </div>
      </div>

      <div className="shrink-0 p-4 pt-0">
        <Skeleton className="h-12 w-full rounded-2xl" />
      </div>
    </div>
  );
}
