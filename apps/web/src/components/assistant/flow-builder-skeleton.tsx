import { Skeleton } from "@agent-hub/ui";

/**
 * The new-Flow and edit-Flow boundary. Mirrors the builder's form view, its
 * default: the centred `max-w-2xl` column, the one-line header (back link,
 * name field, undo/redo, the form/canvas toggle), then the Trigger,
 * Conditions and Response cards. The generic form skeleton was left-aligned,
 * so the builder slid right when it streamed in.
 */
export function FlowBuilderSkeleton() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-5 sm:px-5" role="status" aria-busy="true">
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading flow…</span>
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-9 min-w-0 flex-1" />
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-28 rounded-lg" />
      </div>
      <div className="mt-4 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-xl border p-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
