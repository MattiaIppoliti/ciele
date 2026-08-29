import { Skeleton } from "@agent-hub/ui";

/**
 * Shared loading skeleton for admin routes that had no `loading.tsx` at all.
 *
 * Nineteen of the console's forty-five segments had a boundary; the rest showed
 * the previous page frozen until the server answered, which reads as a click
 * that did nothing. These are deliberately generic: a skeleton's job is to say
 * "this is arriving, and roughly this shape", and a hand-drawn one per route is
 * more surface to keep true than the accuracy is worth. Routes whose shape is
 * genuinely distinctive (Inbox's three panes, the assistant editor) keep their
 * own.
 */
export function RouteSkeleton({
  variant = "list",
  title = true,
}: {
  /**
   * `list` = stacked rows, `grid` = cards, `form` = label/field pairs,
   * `prose` = a legal/policy document, `hero` = a marketing page's content slot
   * (the (marketing) layout already supplies the header and footer).
   */
  variant?: "list" | "grid" | "form" | "prose" | "hero";
  title?: boolean;
}) {
  return (
    <div className="flex h-full flex-col gap-5 p-6" aria-busy="true">
      {title && variant !== "hero" && variant !== "prose" && (
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="ml-auto h-9 w-32" />
        </div>
      )}
      {variant === "grid" && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-3 rounded-xl border p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-9 shrink-0 rounded-lg" />
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      )}
      {variant === "list" && (
        <div className="space-y-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-xl border px-4 py-3"
            >
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-3/4" />
              </div>
              <Skeleton className="h-3 w-16 shrink-0" />
            </div>
          ))}
        </div>
      )}
      {variant === "prose" && (
        <div className="mx-auto max-w-3xl space-y-8">
          {Array.from({ length: 4 }).map((_, section) => (
            <div key={section} className="space-y-3">
              <Skeleton className="h-5 w-56" />
              {Array.from({ length: 5 }).map((_, line) => (
                <Skeleton
                  key={line}
                  className="h-3"
                  style={{ width: `${92 - line * 7}%` }}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      {variant === "hero" && (
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-5 pt-24 text-center">
          <Skeleton className="h-12 w-4/5" />
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="mt-2 h-4 w-1/2" />
          <div className="mt-4 flex gap-3">
            <Skeleton className="h-11 w-36 rounded-full" />
            <Skeleton className="h-11 w-36 rounded-full" />
          </div>
          <Skeleton className="mt-10 h-72 w-full rounded-2xl" />
        </div>
      )}
      {variant === "form" && (
        <div className="max-w-2xl space-y-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
