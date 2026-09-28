import { Skeleton } from "@agent-hub/ui";

/**
 * Mirrors `HelpDeskManage`: the back-link header, then the centred
 * `max-w-4xl` body (name, description, Support Channels card). The generic
 * form skeleton was left-aligned with no header row, so the editor jumped
 * down and right on arrival.
 */
export default function HelpDeskLoading() {
  return (
    <div className="flex h-full flex-col overflow-y-auto" role="status" aria-busy="true">
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading help desk…</span>
      <header className="flex shrink-0 items-center gap-3 px-6 pt-5 pb-4">
        <Skeleton className="h-5 w-24" />
      </header>
      <div className="mx-auto w-full max-w-4xl flex-1 border-t px-8 py-8">
        {/* Measured against the rendered editor: the 40px name field, the
            18px hint, the 59px description, then the Support Channels card
            (a 64px header row over its channel list). */}
        <Skeleton className="h-11 w-72" />
        <Skeleton className="mt-4 h-5 w-2/3" />
        <Skeleton className="mt-2 h-16 w-full" />
        <div className="mt-7.5 mb-8 border-t" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-1 h-5 w-3/4" />
        <div className="mt-5 overflow-hidden rounded-xl border">
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <Skeleton className="h-11 w-72" />
            <Skeleton className="ml-auto h-9 w-28" />
          </div>
          <div className="space-y-2 p-4">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-28 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
