import { Skeleton } from "@agent-hub/ui";

/**
 * A Settings tab while it loads, inside the dialog's content pane (which
 * already pads it). Mirrors SettingsPanel, measured against the rendered
 * General tab: the centred max-w-2xl column, the icon tile beside the title and its
 * one-line description, then either the grouped cards of a form tab or the
 * toolbar and rows of a list tab. The shared RouteSkeleton added a second
 * layer of padding and a title-bar button no tab has.
 */
export function SettingsPanelSkeleton({ variant }: { variant: "form" | "list" }) {
  return (
    <div className="mx-auto max-w-2xl pr-6" role="status" aria-busy="true">
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading settings…</span>
      <div className="flex items-center gap-5">
        <Skeleton className="size-16 shrink-0 rounded-2xl" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="mt-1 h-5 w-80 max-w-full" />
        </div>
      </div>
      {variant === "form" ? (
        <div className="mt-8 space-y-9">
          <Skeleton className="h-38.5 w-full rounded-xl" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-25.5 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="ml-auto h-9 w-32" />
          </div>
          <div className="overflow-hidden rounded-xl border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 border-t px-5 py-4 first:border-t-0">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-24 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
