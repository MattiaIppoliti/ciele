import { Skeleton } from "@agent-hub/ui";

/**
 * Section-level streaming boundary inside the assistant editor: switching
 * SETUP route modules keep the shell chrome, sidebar, top bar,
 * Preview panel: in place and only the center column shows this while its
 * data loads.
 */
export default function AssistantSectionLoading() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8 sm:py-8" aria-busy="true">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-2 h-4 w-72" />
      <div className="mt-8 space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}
