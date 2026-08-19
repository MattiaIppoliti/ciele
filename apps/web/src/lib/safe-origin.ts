/**
 * The origin check shared by everything that templates a deployment address
 * into a shell script a user will paste into their terminal, the local
 * connector's install one-liner and the self-host installer.
 *
 * It is deliberately strict rather than merely well-formed: https everywhere
 * except loopback (a plaintext install command on a real host is a
 * man-in-the-middle waiting to happen), and no embedded credentials, which
 * would otherwise travel into a user's shell history.
 *
 * Zero dependencies, so it is cheap to import from a route, a lib or a
 * component.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Returns the bare origin (no trailing slash, no path) or throws. Throwing
 * rather than falling back is the point: a caller that cannot prove its own
 * address should emit no command at all.
 */
export function normalizeSafeOrigin(rawOrigin: string): string {
  const url = new URL(rawOrigin);
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) ||
    url.username ||
    url.password
  ) {
    throw new Error("Unsupported Ciele origin.");
  }
  return url.origin;
}
