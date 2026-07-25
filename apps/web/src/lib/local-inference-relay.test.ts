import { describe, expect, it, vi } from "vitest";
import { getMockDb, shortId } from "@agent-hub/db";

// The relay obtains its Db through the facade seam; the in-memory mock adapter
// implements the same contract-pinned behavioural methods as the Supabase one,
// so these tests exercise the real relay logic over real (mock) storage.
vi.mock("./relay-db", () => ({
  getRelayDb: () => getMockDb(),
  isRelayDbConfigured: () => true,
}));

import {
  createRelayCliRunner,
  listActiveRelayProviders,
} from "./local-inference-relay";

const db = getMockDb();

/** A unique member+origin per test — the mock store is a shared singleton. */
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
    // operator rejects it with "invalid input syntax for type json" — so the
    // provider predicate must run on the fetched fresh-device set instead.
    const m = member();
    await pairFreshDevice(m, ["anthropic"]);
    const runner = createRelayCliRunner(m);

    await expect(
      runner({ provider: "openai", modelId: "gpt-test", prompt: "hello" })
    ).rejects.toThrow("offline");
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
