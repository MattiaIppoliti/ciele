import { Skeleton } from "@agent-hub/ui";

/**
 * Mirrors the confirmation page: a short panel (heading, one line, the action)
 * in a centred max-w-xl column. The prose variant drew a four-section policy
 * document, so the page snapped from a long page into a short one.
 */
export default function NewsletterConfirmLoading() {
  return (
    <div
      className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col justify-center gap-6 px-6 py-24"
      role="status"
      aria-busy="true"
    >
      {/* A skeleton is silent to a screen reader; this is what it hears. */}
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="mt-2 h-10 w-40 rounded-full" />
      </div>
    </div>
  );
}
