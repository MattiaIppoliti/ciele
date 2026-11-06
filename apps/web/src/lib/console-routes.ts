/**
 * Which paths belong to the signed-in console (the `(admin)` route group) as
 * opposed to the public site.
 *
 * Needed because a few root-layout concerns have to tell the two apart, the
 * cookie-consent banner is one: consent is collected on the public site, where
 * the trackers live, and the console deliberately carries neither. The list is
 * pinned to the filesystem by `console-routes.test.ts`, so a new admin section
 * cannot quietly fall out of it.
 */

/** Top-level segments served by the `(admin)` group. */
export const CONSOLE_PATH_PREFIXES = [
  "/alerts",
  "/assistants",
  "/eval",
  "/help-desks",
  "/improvements",
  "/inbox",
  "/insights",
  "/library",
  // The work section (#1053), and a Member's own notifications (#1067).
  "/my-tasks",
  "/notifications",
  "/projects",
  "/tasks",
  // Human review decision pages (#841): a signed link lands here, behind the login wall.
  "/reviews",
  "/settings",
  "/setup",
  "/teammates",
] as const;

/**
 * Top-level segments served by the `(marketing)` group, the public site the
 * marketing home links to. Every one of them must stay reachable signed-out,
 * so the auth gate in `middleware.ts` treats these subtrees as public. Pinned
 * to the filesystem by `console-routes.test.ts` the same way the console list
 * is, so a new marketing section cannot land behind the login wall.
 */
const MARKETING_ROUTES = {
  "/change-log": ["/change-log"],
  "/contact": ["/contact/sales"],
  "/download": ["/download"],
  "/enterprise": ["/enterprise"],
  // Feature paths come from the feature catalog in the sitemap.
  "/features": [],
  "/home": ["/home"],
  // Confirmation is public, but its token-specific page is not indexed.
  "/newsletter": [],
  "/policies": [
    "/policies/privacy",
    "/policies/terms-of-service",
    "/policies/cookies",
    "/policies/dpa",
    "/policies/subprocessors",
  ],
  "/pricing": ["/pricing"],
  "/security": [
    "/security",
    "/security/gdpr",
    "/security/responsible-disclosure",
  ],
} as const;

export const MARKETING_PATH_PREFIXES = Object.keys(MARKETING_ROUTES);
export const MARKETING_SITEMAP_PATHS = Object.values(MARKETING_ROUTES).flat();

/** True for the public marketing site's routes. */
export function isMarketingPath(pathname: string): boolean {
  return MARKETING_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * Top-level segments served outside both route groups (auth, the widget, the
 * API). Pinned to the filesystem by `console-routes.test.ts`.
 */
const APP_ROOT_SEGMENTS = [
  "/api",
  "/application-connect",
  "/join",
  "/login",
  "/onboarding",
  "/signup",
  "/subscription-connect",
  "/widget",
] as const;

/** Files served from the app root, outside any segment. */
const APP_ROOT_FILES = /^\/(?:robots\.txt|sitemap\.xml|llms\.txt|install\.sh|icon\.svg|opengraph-image(?:\.png)?)$/;

export const APP_ROOT_SEGMENT_PREFIXES: readonly string[] = APP_ROOT_SEGMENTS;

/**
 * Does any route in this app answer the path? The auth gate sends a
 * signed-out request for a known route to /login, but an unknown path has to
 * reach the 404 page: redirecting it made every dead URL a 307 to a
 * robots-disallowed /login, which search engines keep re-crawling as
 * "page with redirect" instead of dropping.
 */
export function isAppRoute(pathname: string): boolean {
  return (
    isConsolePath(pathname) ||
    isMarketingPath(pathname) ||
    APP_ROOT_FILES.test(pathname) ||
    APP_ROOT_SEGMENTS.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    )
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
