/**
 * Which paths belong to the signed-in console (the `(admin)` route group) as
 * opposed to the public site.
 *
 * Needed because a few root-layout concerns have to tell the two apart — the
 * cookie-consent banner is one: consent is collected on the public site, where
 * the trackers live, and the console deliberately carries neither. The list is
 * pinned to the filesystem by `console-routes.test.ts`, so a new admin section
 * cannot quietly fall out of it.
 */

/** Top-level segments served by the `(admin)` group. */
export const CONSOLE_PATH_PREFIXES = [
  "/alerts",
  "/assistants",
  "/help-desks",
  "/improvements",
  "/inbox",
  "/insights",
  "/settings",
  "/setup",
] as const;

/**
 * Top-level segments served by the `(marketing)` group — the public site the
 * marketing home links to. Every one of them must stay reachable signed-out,
 * so the auth gate in `middleware.ts` treats these subtrees as public. Pinned
 * to the filesystem by `console-routes.test.ts` the same way the console list
 * is, so a new marketing section cannot land behind the login wall.
 */
export const MARKETING_PATH_PREFIXES = [
  "/enterprise",
  "/features",
  "/policies",
  "/pricing",
  "/security",
] as const;

/** True for the public marketing site's routes (the `/home` landing aside). */
export function isMarketingPath(pathname: string): boolean {
  return MARKETING_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/** True for the console's own routes, including its dashboard at `/`. */
export function isConsolePath(pathname: string): boolean {
  // The `(admin)` group owns the root route: `/` is the Assistants dashboard,
  // while the public landing page is `/home`.
  if (pathname === "/") return true;
  return CONSOLE_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
