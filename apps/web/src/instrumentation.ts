/**
 * Next.js instrumentation — runs once when the server process starts.
 *
 * Two startup registrations, both guarded to the Node.js runtime because each
 * pulls server-only code that must never load into the edge runtime:
 *
 * 1. The **runtime host ports** (`@agent-hub/agent`'s `host.ts`). The agent
 *    package is framework-free, so the two things only a Next server can do are
 *    handed to it here: reading the cached platform prompt, and running work
 *    after the response is sent. Both have safe defaults, so a missed
 *    registration degrades latency, never correctness.
 * 2. The **enterprise registration entrypoint**, so the enterprise edition can
 *    register its capability overrides before any request is served (#435). In
 *    the open-source edition that entrypoint is an inert stub, so it is a no-op.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { after } = await import("next/server");
  const { registerRuntimeHost } = await import("@agent-hub/agent");
  const { getPlatformSystemPrompt } = await import("@/lib/platform");

  registerRuntimeHost({
    getPlatformSystemPrompt,
    // `after` keeps the invocation alive for the returned promise, which is what
    // makes it safe to hand a job drain to — see the port's contract.
    scheduleAfterResponse: (work) => after(work),
  });

  await import("@/ee/register");
}
