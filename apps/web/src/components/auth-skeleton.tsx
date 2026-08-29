import { Skeleton } from "@agent-hub/ui";

/**
 * Loading state for the sign-in / sign-up / invite / onboarding routes.
 *
 * Separate from `RouteSkeleton` because those live outside the admin shell:
 * there is no sidebar or page header to stand in for, just a centred card on an
 * empty page, and the admin skeleton's padded full-height column reads as a
 * broken layout there.
 */
export function AuthSkeleton({
  /** Rough number of input rows to stand in for. */
  fields = 2,
}: {
  fields?: number;
}) {
  return (
    <div
      className="flex min-h-svh items-center justify-center p-6"
      aria-busy="true"
    >
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="size-10 rounded-xl" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: fields }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
        <Skeleton className="mx-auto h-3 w-44" />
      </div>
    </div>
  );
}
