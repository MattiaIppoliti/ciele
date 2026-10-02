import { Skeleton } from "@agent-hub/ui";

export default function Loading() {
  return <div aria-busy="true" role="status" aria-label="Loading new teammate" className="mx-auto w-full max-w-3xl space-y-10 px-8 py-10"><Skeleton className="h-16 w-80" /><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>;
}
