// What the app says when a server does not answer, and which session a mode
// gets. Pure string and number work, deliberately kept out of `windows.ts`.
//
// `windows.ts` imports `electron` at module scope, and importing it is enough
// to make Node resolve the downloaded Electron binary. These three functions
// need none of that, so a unit test for the wording should not depend on a
// 300MB download having succeeded. Keeping them here is what lets
// `pnpm test` stay the pure suite its vitest config says it is, with the
// Electron glue left to `pnpm test:e2e`.
//
// `windows.ts` re-exports all three, so callers still import them from there.

import type { Mode } from "../shared/state";

/** Per-mode partition: a SaaS account and a local stack coexist, separately. */
export function partitionForMode(mode: Mode): string {
  return `persist:ciele-${mode}`;
}

/**
 * Turn Chromium's error codes into something a person can act on.
 *
 * The alternative is what the app did before: leave the browser's own error
 * page, or worse, a hosting provider's 404, sitting in a window with no
 * address bar, no reload button and no way back except the menu bar.
 */
export function loadFailureReason(errorCode: number, description: string): string {
  switch (errorCode) {
    case -105: // ERR_NAME_NOT_RESOLVED
      return "That address does not exist. Check the server address for a typo.";
    case -102: // ERR_CONNECTION_REFUSED
      return "Nothing is listening at that address. If this is your own server, check it is running.";
    case -106: // ERR_INTERNET_DISCONNECTED
      return "This machine is offline.";
    case -7: // ERR_TIMED_OUT
      return "The server took too long to answer.";
    case -501: // ERR_INSECURE_RESPONSE
      return "The server's security certificate could not be trusted.";
    case -312: // ERR_UNSAFE_PORT
      return "Browsers refuse to connect on that port. Use a different one, 3000 and 8080 are safe choices.";
    default:
      return description ? `The server could not be reached (${description}).` : "The server could not be reached.";
  }
}

/** What a status code means when it is the *first* thing an origin says. */
export function httpFailureReason(status: number, origin: string): string | null {
  if (status < 400) return null;
  if (status === 404) {
    // The case that prompted this: a hostname parked at a provider with no
    // deployment behind it answers 404 for everything, including `/`.
    return `${origin} answered, but there is no Ciele there. Check the server address.`;
  }
  if (status === 401 || status === 403) return null; // a sign-in wall is not a failure
  if (status >= 500) return `${origin} is having trouble (HTTP ${status}). Try again shortly.`;
  return `${origin} answered HTTP ${status} instead of the app.`;
}
