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

/**
 * The hosts this deployment answers on when nothing is configured. A mailed
 * link may only ever point at one of these or at the configured origin: an
 * emailed URL carries a signed token, so a permissive proxy that let an
 * attacker set `Host` would otherwise turn a legitimate email into a token
 * disclosure (#801, CYB-10).
 */
// One origin serves the whole product (root CLAUDE.md §10): there is no
// `platform.` host, and listing one would let a proxy that forwards that
// `Host` mint links to a name nothing answers on.
const KNOWN_PUBLIC_HOSTS = new Set(["ciele.app", "www.ciele.app"]);

function isLocalHost(host: string): boolean {
  // `[::1]:3000` is not `host.split(":")[0]`, which is `[`. Strip a bracketed
  // IPv6 literal first, then a trailing `:port`.
  const name = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : (host.split(":")[0] ?? "");
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]";
}

/**
 * The absolute origin to put in an email. Null means "this deployment cannot
 * name itself", and the caller must refuse to send rather than guess: an
 * unsent confirmation is a support ticket, a confirmation pointing at an
 * attacker is a stolen token.
 *
 * Header-derived only for a host the deployment already claims, and the scheme
 * that host implies, so `X-Forwarded-Proto: http` cannot downgrade a link.
 */
export function mailLinkOrigin(
  requestHeaders: Pick<Headers, "get">,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const configured = (env.CIELE_PUBLIC_ORIGIN ?? env.NEXT_PUBLIC_APP_URL)?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch {
      // Fall through to the allowlist rather than mailing a malformed link.
    }
  }

  const host = requestHeaders.get("host")?.trim().toLowerCase() ?? "";
  if (isLocalHost(host)) return `http://${host}`;
  if (KNOWN_PUBLIC_HOSTS.has(host)) return `https://${host}`;
  return null;
}
