import { Skeleton } from "@agent-hub/ui";

export default function EvalLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-7 px-6 py-8" aria-busy="true">
      <div className="space-y-3"><Skeleton className="h-4 w-44" /><Skeleton className="h-9 w-28" /><Skeleton className="h-4 w-96 max-w-full" /></div>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-72 w-full rounded-xl" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}
