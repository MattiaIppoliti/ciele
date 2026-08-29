import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { shortId } from "@agent-hub/core";
import { getMockDb } from "@agent-hub/db";

// The relay obtains its Db through the facade seam; the in-memory mock adapter
// implements the same contract-pinned behavioural methods as the Supabase one,
// so these tests exercise the real relay logic over real (mock) storage.
vi.mock("./relay-db", () => ({
  getRelayDb: () => getMockDb(),
  isRelayDbConfigured: () => true,
}));

import {
  claimRelayJob,
  createRelayCliRunner,
  listActiveRelayProviders,
} from "./local-inference-relay";

const db = getMockDb();

/** A unique member+origin per test, the mock store is a shared singleton. */
function member() {
  return {
    organizationId: `org-${shortId()}`,
    userId: `user-${shortId()}`,
    origin: `https://preview-${shortId()}.ciele.example.com`,
  };
}

/** A connector paired to this member's origin that just sent a heartbeat. */
async function pairFreshDevice(
  m: ReturnType<typeof member>,
  providers: string[]
) {
  const device = await db.table("localConnectorDevices").insert({
    organizationId: m.organizationId,
    userId: m.userId,
    tokenHash: `tok-${shortId()}`,
    origin: m.origin,
    providers,
  });
  await db
    .table("localConnectorDevices")
    .update(device.id, { lastSeenAt: new Date().toISOString() });
  return device;
}

function jobsFor(m: ReturnType<typeof member>) {
  return db.table("localInferenceJobs").list({ organizationId: m.organizationId });
}

/** A device claimRelayJob can authenticate, with the bearer token to call it. */
async function pairTokenDevice(
  m: ReturnType<typeof member>,
  providers: string[]
) {
  const token = randomBytes(48).toString("base64url");
  const device = await db.table("localConnectorDevices").insert({
    organizationId: m.organizationId,
    userId: m.userId,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    origin: m.origin,
    providers,
  });
  return { authorization: `Bearer ${token}`, deviceId: device.id };
}

function deviceRow(deviceId: string) {
  return db.table("localConnectorDevices").get(deviceId);
}

describe("local inference relay device selection", () => {
  it("discovers providers only from connectors paired to this Preview origin", async () => {
    const m = member();
    await pairFreshDevice(m, ["openai"]);

    await expect(listActiveRelayProviders(m)).resolves.toEqual(["openai"]);
    await expect(
      listActiveRelayProviders({ ...m, origin: "https://elsewhere.example.com" })
    ).resolves.toEqual([]);
  });

  it("queues inference only on a connector paired to this Preview origin", async () => {
    const m = member();
    await pairFreshDevice(m, ["openai"]);
    const runner = createRelayCliRunner({
      ...m,
      origin: "https://elsewhere.example.com",
    });

    await expect(
      runner({ provider: "openai", modelId: "gpt-test", prompt: "hello" })
    ).rejects.toThrow("offline");
    await expect(jobsFor(m)).resolves.toEqual([]); // nothing was queued
  });

  it("matches the advertised provider in TypeScript, not with a jsonb query", async () => {
    // `providers` is jsonb. PostgREST serializes an array passed to
    // `.contains()` as the Postgres-array literal `{openai}`, then the jsonb
    // operator rejects it with "invalid input syntax for type json", so the
    // provider predicate must run on the fetched fresh-device set instead.
    const m = member();
    await pairFreshDevice(m, ["anthropic"]);
    const runner = createRelayCliRunner(m);

    await expect(
      runner({ provider: "openai", modelId: "gpt-test", prompt: "hello" })
    ).rejects.toThrow("offline");
  });
});

describe("claimRelayJob heartbeat", () => {
  it("writes the heartbeat on a device that has never been seen", async () => {
    const m = member();
    const { authorization, deviceId } = await pairTokenDevice(m, ["openai"]);

    await claimRelayJob({ authorization, providers: ["openai"] });

    expect((await deviceRow(deviceId))?.lastSeenAt).toBeTruthy();
  });

  it("does not rewrite a heartbeat that is still fresh", async () => {
    // The connector claims on a timer, so an unconditional write here is one
    // Postgres round trip per poll, forever, per paired device. The seeded
    // timestamp is deliberately seconds old: two writes in the same millisecond
    // would compare equal and let a missing throttle pass unnoticed.
    const m = member();
    const { authorization, deviceId } = await pairTokenDevice(m, ["openai"]);
    const fresh = new Date(Date.now() - 5_000).toISOString();
    await db.table("localConnectorDevices").update(deviceId, { lastSeenAt: fresh });

    await claimRelayJob({ authorization, providers: ["openai"] });

    expect((await deviceRow(deviceId))?.lastSeenAt).toBe(fresh);
  });

  it("keeps a throttled device inside the freshness window Preview reads", async () => {
    // The invariant that makes the throttle safe: skipping writes must never
    // let a live connector read as offline to listActiveRelayProviders.
    const m = member();
    const { authorization, deviceId } = await pairTokenDevice(m, ["openai"]);
    const fresh = new Date(Date.now() - 5_000).toISOString();
    await db.table("localConnectorDevices").update(deviceId, { lastSeenAt: fresh });

    await claimRelayJob({ authorization, providers: ["openai"] }); // skips the write

    await expect(listActiveRelayProviders(m)).resolves.toEqual(["openai"]);
  });

  it("writes again once the heartbeat has gone stale", async () => {
    const m = member();
    const { authorization, deviceId } = await pairTokenDevice(m, ["openai"]);
    const stale = new Date(Date.now() - 60_000).toISOString();
    await db.table("localConnectorDevices").update(deviceId, { lastSeenAt: stale });

    await claimRelayJob({ authorization, providers: ["openai"] });

    expect((await deviceRow(deviceId))?.lastSeenAt).not.toBe(stale);
  });

  it("writes immediately when the advertised providers change", async () => {
    // Providers decide what Preview offers, so this one must not wait out the
    // throttle the way a plain heartbeat does.
    const m = member();
    const { authorization, deviceId } = await pairTokenDevice(m, ["openai"]);

    await claimRelayJob({ authorization, providers: ["openai"] });
    await claimRelayJob({ authorization, providers: ["openai", "anthropic"] });

    expect((await deviceRow(deviceId))?.providers).toEqual([
      "openai",
      "anthropic",
    ]);
  });

  it("rejects a poll that carries no valid device token", async () => {
    await expect(
      claimRelayJob({ authorization: "Bearer nope", providers: ["openai"] })
    ).resolves.toBeNull();
  });
});

describe("createRelayCliRunner poll loop", () => {
  const invocation = {
    provider: "openai" as const,
    modelId: "gpt-test",
    prompt: "hi",
  };

  /** The relay job the runner just queued (it inserts before polling). */
  async function queuedJob(m: ReturnType<typeof member>) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const [job] = await jobsFor(m);
      if (job) return job;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("the runner never queued a relay job");
  }

  it("returns the job result once the connector reports completed", async () => {
    const m = member();
    const device = await pairFreshDevice(m, ["openai"]);
    const run = createRelayCliRunner(m)(invocation);

    // Act as the connector: claim the queued job, then report its result.
    const job = await queuedJob(m);
    const claimed = await db.claimNextLocalInferenceJob({
      deviceId: device.id,
      now: new Date().toISOString(),
    });
    expect(claimed?.id).toBe(job.id);
    await db.completeLocalInferenceJob({
      jobId: job.id,
      deviceId: device.id,
      result: { text: "answer" },
      now: new Date().toISOString(),
    });

    await expect(run).resolves.toEqual({ text: "answer" });
    await expect(jobsFor(m)).resolves.toEqual([]); // job is always cleaned up
  });

  it("throws the connector's error when the job fails", async () => {
    const m = member();
    const device = await pairFreshDevice(m, ["openai"]);
    const run = createRelayCliRunner(m)(invocation);

    const job = await queuedJob(m);
    await db.claimNextLocalInferenceJob({
      deviceId: device.id,
      now: new Date().toISOString(),
    });
    await db.completeLocalInferenceJob({
      jobId: job.id,
      deviceId: device.id,
      error: "provider exploded",
      now: new Date().toISOString(),
    });

    await expect(run).rejects.toThrow("provider exploded");
    await expect(jobsFor(m)).resolves.toEqual([]);
  });

  it("aborts before polling when the caller's signal is already aborted", async () => {
    const m = member();
    await pairFreshDevice(m, ["openai"]);
    const signal = AbortSignal.abort(new Error("caller went away"));

    await expect(
      createRelayCliRunner(m)({ ...invocation, signal })
    ).rejects.toThrow("caller went away");
    await expect(jobsFor(m)).resolves.toEqual([]); // still cleaned up via finally
  });
});
