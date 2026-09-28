import { Skeleton } from "@agent-hub/ui";

export default function EvalLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6" role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {/* Title, then the one-line description (mt-2): 55px together. */}
      <div>
        <Skeleton className="h-8 w-24" />
        <Skeleton className="mt-2 h-5 w-full max-w-3xl" />
      </div>
      {/* Runs / Datasets / Models */}
      <Skeleton className="h-10 w-64 rounded-lg" />
      {/* "New experiment" card, then the run list. */}
      <Skeleton className="h-72 w-full rounded-xl" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}
