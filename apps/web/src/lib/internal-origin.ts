/**
 * The origin this deployment calls its own `/api/v1` on.
 *
 * The hosted MCP endpoint re-enters the API over HTTP so that one execution
 * path serves every transport, and it forwards **the caller's own API key** to
 * whatever origin it is given. That made deriving the origin from the request
 * a credential-forwarding sink: a reverse proxy that passes an untrusted
 * `Host` / `X-Forwarded-Host` would have this server post a live Bearer key to
 * the host the attacker named (#801, CYB-03).
 *
 * So nothing here reads a header. The origin comes from configuration, from
 * the platform's own deployment variable, or from loopback, in that order, and
 * loopback is the answer that needs no configuration at all: `next start`
 * inside a container serves the same routes on `$PORT`, and reachability from
 * the server is the only property this origin needs.
 */

const LOOPBACK_HOST = "127.0.0.1";

/** Accepts only an absolute http/https origin carrying no credentials. */
function parseOrigin(value: string | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url.origin;
}

/**
 * Resolved from `env` alone, so a test can state the deployment shape instead
 * of building a Request. Never returns null: the loopback fallback is always
 * available and always this same server.
 */
export function internalApiOrigin(
  env: Record<string, string | undefined> = process.env,
): string {
  // 1. The operator's explicit answer. A self-host behind a proxy that
  //    terminates TLS elsewhere sets this to the app's real internal address.
  const configured = parseOrigin(env.CIELE_INTERNAL_API_ORIGIN);
  if (configured) return configured;

  // 2. Vercel names the *running deployment*, set by the platform rather than
  //    by the request. On a preview that is the only origin serving this
  //    code. In production the deployment URL sits behind Deployment
  //    Protection, whose SSO interstitial answers instead of /api/v1, so the
  //    canonical public origin wins there when one is configured; it is the
  //    same code, and it is the host the protection exempts.
  const vercel = parseOrigin(
    env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined,
  );
  const publicOrigin = parseOrigin(
    env.CIELE_PUBLIC_ORIGIN ?? env.NEXT_PUBLIC_APP_URL,
  );
  if (vercel && env.VERCEL_ENV === "production" && publicOrigin) return publicOrigin;
  if (vercel) return vercel;

  // 3. The deployment's configured public origin, when it has one.
  if (publicOrigin) return publicOrigin;

  // 4. This process, on its own port.
  const port = env.PORT && /^\d+$/.test(env.PORT) ? env.PORT : "3000";
  return `http://${LOOPBACK_HOST}:${port}`;
}
