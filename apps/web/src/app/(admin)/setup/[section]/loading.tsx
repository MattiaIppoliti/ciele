import { Skeleton } from "@agent-hub/ui";

/**
 * Mirrors the SETUP picker page: a narrow centred column (icon, "Continue to
 * …", subtitle) over the fixed-height picker card. The generic card grid it
 * replaced was full width, so the page collapsed into a column on arrival.
 */
export default function SetupLoading() {
  return (
    <div className="h-full overflow-y-auto" role="status" aria-busy="true">
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading…</span>
      <div className="mx-auto flex max-w-md flex-col items-center px-6 py-20">
        <Skeleton className="size-14 rounded-xl" />
        <Skeleton className="mt-5 h-7.5 w-56" />
        <Skeleton className="mt-1 h-5 w-48" />
        <div className="mt-8 flex h-[560px] max-h-[75vh] w-full flex-col overflow-hidden rounded-[32px] border px-6 pt-6">
          <div className="mb-5 flex items-center justify-between">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="size-9 rounded-full" />
          </div>
          <Skeleton className="h-11 w-full rounded-2xl" />
          <div className="mt-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-4">
                <Skeleton className="size-12 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3.5 w-24" />
                </div>
                <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
