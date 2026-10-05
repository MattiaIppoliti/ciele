import { Skeleton } from "@agent-hub/ui";

export function CatalogLoading() {
  return <div role="status" aria-busy="true" aria-label="Loading preview" className="space-y-4"><Skeleton className="h-4 w-48" /><Skeleton className="h-9 w-64 max-w-full" /><Skeleton className="h-4 w-full max-w-xl" /><Skeleton className="h-9 w-64 max-w-full rounded-full" /><Skeleton className="h-64 w-full rounded-xl" /></div>;
}
