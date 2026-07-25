/**
 * Next.js instrumentation — runs once when the server process starts.
 *
 * Loads the enterprise registration entrypoint so the enterprise edition can
 * register its capability overrides before any request is served (#435). In
 * the open-source edition that entrypoint is an inert stub, so this is a no-op.
 * Guarded to the Node.js runtime — the enterprise wiring pulls server-only code
 * that must never load into the edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/ee/register");
  }
}
