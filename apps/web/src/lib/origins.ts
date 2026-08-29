/**
 * The deployment's two origins, each defined once rather than as the same
 * env-var expression repeated: a self-host that configures its own origin must
 * not have half the app keep pointing at the hosted one.
 */

/** Where the documentation site lives for this deployment. */
export function docsOrigin(): string {
  return process.env.DOCS_ORIGIN?.replace(/\/$/, "") ?? "https://docs.ciele.app";
}

/**
 * This deployment's own app origin. Callers supply the fallback because they
 * know something this module does not: a route handler falls back to the
 * request's own origin, a Stripe return URL to the hosted platform.
 */
export function appOrigin(fallback: string): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || fallback;
}
