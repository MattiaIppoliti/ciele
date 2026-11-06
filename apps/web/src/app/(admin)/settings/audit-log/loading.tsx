import { Skeleton } from "@agent-hub/ui";
export default function Loading() { return <div className="mx-auto max-w-3xl space-y-5 pr-6" aria-busy="true"><Skeleton className="h-12 w-60" /><Skeleton className="h-40 w-full" />{Array.from({ length: 5 }).map((_,index) => <Skeleton key={index} className="h-28 w-full" />)}</div>; }
