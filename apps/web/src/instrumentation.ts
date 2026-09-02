/**
 * Next.js instrumentation: runs once when the server process starts.
 *
 * Two startup registrations, both guarded to the Node.js runtime because each
 * pulls server-only code that must never load into the edge runtime:
 *
 * 1. The **runtime host ports** (`@agent-hub/agent`'s `host.ts`). The agent
 *    package is framework-free, so the facts only this host knows are handed to
 *    it here: reading the cached platform prompt, running work after the
 *    response is sent, and whether this deployment may relax the egress
 *    posture. All have safe defaults, so a missed registration degrades
 *    latency (or tightens security), never correctness.
 * 2. The **enterprise registration entrypoint**, so the enterprise edition can
 *    register its capability overrides before any request is served (#435). In
 *    the open-source edition that entrypoint is an inert stub, so it is a no-op.
 *
 * And two startup **assertions**. CYB-16 (#801): a production build whose
 * public origin is plain HTTP on a non-loopback host refuses to start unless
 * `CIELE_ALLOW_INSECURE_HTTP=1` says that is the intent (`lib/secure-origin.ts`
 * holds the rule). CYB-02 (#801): a deployment that talks to a
 * real database must carry `APP_ENCRYPTION_KEY`. `sealSecret` already refuses
 * to write without it, but per-write refusal surfaces as a failed Settings
 * form weeks after the misconfiguration; a process that refuses to start
 * surfaces it to the operator who caused it, at the moment they caused it.
 * The Supabase-less demo mode still lets you paste a provider key into
 * Settings, it just stores it in the in-memory store, so instead of requiring
 * a key it gets an ephemeral one: sealed values live exactly as long as the
 * store they are sealed into, and the fail-closed core stays fail-closed.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { insecurePublicOriginReason } = await import("@/lib/secure-origin");
  const insecure = insecurePublicOriginReason(process.env);
  if (insecure) throw new Error(insecure);

  const { isSupabaseConfigured } = await import("@agent-hub/db");
  if (!isSupabaseConfigured() && !process.env.APP_ENCRYPTION_KEY) {
    // Demo mode: the mock store is per-process memory, so a per-process key
    // is exactly as durable as what it seals. This keeps `sealSecret`
    // fail-closed without making the zero-config demo refuse a Settings form.
    const { randomBytes } = await import("node:crypto");
    process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  }
  if (isSupabaseConfigured() && !process.env.APP_ENCRYPTION_KEY) {
    throw new Error(
      "APP_ENCRYPTION_KEY is not set. It seals every stored credential (provider keys, SSO, help desks, application OAuth), so a Supabase-backed deployment must not start without it. Set it in the environment (deploy/bootstrap.sh generates one) and restart."
    );
  }

  const { after } = await import("next/server");
  const { registerRuntimeHost } = await import("@agent-hub/agent");
  const { getPlatformSystemPrompt } = await import("@/lib/platform");

  registerRuntimeHost({
    getPlatformSystemPrompt,
    // `after` keeps the invocation alive for the returned promise, which is what
    // makes it safe to hand a job drain to, see the port's contract.
    scheduleAfterResponse: (work) => after(work),
    // Dev and preview deployments may point tenant-configured requests at
    // plain-HTTP / loopback mocks; production never does. The port defaults to
    // strict, so only this registration ever relaxes it (#577).
    //
    // Tested positively, never as "not production": `VERCEL_ENV` is unset on
    // every non-Vercel host, so `!== "production"` read an absent variable as a
    // dev signal and relaxed the policy on all self-host, Docker and Desktop
    // installs. `NODE_ENV` is pinned to production by the Dockerfile and by
    // `next start`, so this keeps the carve-out for `next dev` only.
    allowRelaxedEgress: () =>
      process.env.NODE_ENV !== "production" ||
      process.env.VERCEL_ENV === "preview" ||
      process.env.VERCEL_ENV === "development",
  });

  await import("@/ee/register");
}
