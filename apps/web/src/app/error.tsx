"use client";

import { useEffect } from "react";
import Link from "next/link";
import { isStaleBundleError } from "@/lib/stale-bundle";

const RELOAD_KEY = "ciele:stale-bundle-reload";

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
 *
 * Two additions since. The error is written to the console, because a
 * client-side throw during a soft navigation leaves no trace on the server and
 * the boundary was the only witness. And a stale bundle reloads itself: a tab
 * left open across a deploy keeps the old runtime, and its first navigation
 * into a route it had not loaded asks the new deployment for modules the old
 * runtime cannot link. Nothing in the app is wrong there, the tab is, and the
 * reload the user would do by hand is done once for them.
 */

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    if (!isStaleBundleError(error)) return;
    // Once per path per tab. If storage is unavailable the reload is skipped
    // rather than risked in a loop; the buttons below still work.
    try {
      const key = `${RELOAD_KEY}:${window.location.pathname}`;
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, String(Date.now()));
    } catch {
      return;
    }
    window.location.reload();
  }, [error]);

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
        {(error.digest || error.message) && (
          // The digest names a server-side failure; the message is what a
          // client-side throw has instead. Either is what support needs to hear.
          <p className="text-muted-foreground pt-4 font-mono text-xs break-words">
            {error.digest ?? error.message}
          </p>
        )}
      </div>
    </main>
  );
}
