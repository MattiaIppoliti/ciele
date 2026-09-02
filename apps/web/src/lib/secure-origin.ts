/**
 * The production process refuses to start on a public plain-HTTP origin
 * (#801, CYB-16, the remediation item the first pass left out).
 *
 * Binding the self-host ports to loopback made "on the internet over HTTP"
 * an opt-in, but the opt-in (`BIND_ADDRESS=0.0.0.0`, a PUBLIC_URL pointing at
 * a LAN address) still boots quietly, and everything this app hands a browser
 * on that origin, the session cookie, a signed newsletter token, an API key
 * pasted into Settings, then travels in the clear. So the check moves to the
 * one moment the operator who configured it is watching: startup.
 *
 * Loopback is exempt because `http://localhost:3000` is how every local stack
 * and the Desktop wizard run, and there is no network between the browser and
 * that origin to eavesdrop on. `CIELE_ALLOW_INSECURE_HTTP=1` is the explicit
 * way past it for the honest cases (a LAN-only install, TLS terminated on a
 * proxy the app never sees), and it has to be typed, so it is a decision.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Every variable that names this install's public origin. `PUBLIC_URL` is the
 * one `deploy/.env` configures and the one GoTrue redirects to, so it is the
 * one a self-host on a LAN address actually sets; the first cut read only the
 * other two, and `BIND_ADDRESS=0.0.0.0` + `PUBLIC_URL=http://192.168.1.20:3000`
 * booted quietly (#801 review, round 2). All three are checked rather than the
 * first one set: an https `PUBLIC_URL` beside an http `CIELE_PUBLIC_ORIGIN`
 * still puts a signed link on the wire in the clear.
 */
const ORIGIN_VARIABLES = ["PUBLIC_URL", "CIELE_PUBLIC_ORIGIN", "NEXT_PUBLIC_APP_URL"] as const;

/** The configured public origins, each with the variable that set it. */
function configuredPublicOrigins(
  env: Record<string, string | undefined>
): Array<{ variable: string; origin: URL }> {
  const origins: Array<{ variable: string; origin: URL }> = [];
  for (const variable of ORIGIN_VARIABLES) {
    const raw = env[variable]?.trim();
    if (!raw) continue;
    try {
      origins.push({ variable, origin: new URL(raw) });
    } catch {
      // Not this check's job: the origin parser elsewhere refuses to build
      // links from an unparsable value.
    }
  }
  return origins;
}

function isLoopback(origin: URL): boolean {
  return LOOPBACK_HOSTS.has(origin.hostname) || origin.hostname.endsWith(".localhost");
}

/**
 * Null when the deployment may start; otherwise the reason it must not, in
 * words an operator can act on. Pure over `env` so the rule is testable
 * without a process to kill.
 */
export function insecurePublicOriginReason(
  env: Record<string, string | undefined>
): string | null {
  if (env.NODE_ENV !== "production") return null;
  if (env.CIELE_ALLOW_INSECURE_HTTP === "1") return null;
  const insecure = configuredPublicOrigins(env).find(
    ({ origin }) => origin.protocol === "http:" && !isLoopback(origin)
  );
  if (!insecure) return null;
  return (
    `The public origin ${insecure.origin.origin} (${insecure.variable}) is plain HTTP on a non-loopback host. ` +
    "Session cookies, signed links and pasted credentials would travel in the clear. " +
    "Put TLS in front (deploy/docker-compose.tls.yml, or your own proxy) and set the " +
    "https:// origin, or set CIELE_ALLOW_INSECURE_HTTP=1 to run over HTTP on purpose."
  );
}
