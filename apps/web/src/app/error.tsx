"use client";

import Link from "next/link";

/**
 * The boundary the console never had.
 *
 * It lives at the app root rather than inside `(admin)` because a segment's
 * own `error.tsx` does not catch a throw in that segment's `layout.tsx`, and
 * the throw this exists for came from `(admin)/layout.tsx` resolving the
 * session. Without it, one transient read failure handed the whole document to
 * Next's built-in error page and the app went blank.
 *
 * `reset()` re-renders the failed tree in place, which is all the user was
 * doing by hand when they hit reload and it worked.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-2xl">Something went wrong</h1>
        <p className="text-muted-foreground text-sm">
          That request did not go through. Trying again usually works.
        </p>
        <div className="flex justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={reset}
            className="bg-foreground text-background rounded-md px-4 py-2 text-sm font-medium"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-md border px-4 py-2 text-sm font-medium"
          >
            Back to assistants
          </Link>
        </div>
        {error.digest && (
          <p className="text-muted-foreground pt-4 font-mono text-xs">
            {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
