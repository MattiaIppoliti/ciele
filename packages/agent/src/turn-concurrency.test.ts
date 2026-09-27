import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TURN_CONCURRENCY,
  TurnBusyError,
  admitTurnConcurrency,
  queueDelayMs,
  turnConcurrencyLimits,
  turnConcurrencyScopes,
  turnOverloadOf,
} from "./turn-concurrency";

const ORG = "org-1";

describe("turnConcurrencyLimits", () => {
  it("keeps the defaults when nothing is configured", () => {
    expect(turnConcurrencyLimits({})).toEqual(DEFAULT_TURN_CONCURRENCY);
  });

  it("reads positive integers, turns a scope off with 0 or off, ignores junk", () => {
    expect(
      turnConcurrencyLimits({
        CHAT_MAX_CONCURRENT_TURNS_PER_ORG: "12",
        CHAT_MAX_CONCURRENT_TURNS_PER_PLATFORM_PROVIDER: "off",
      })
    ).toMatchObject({ perOrganization: 12, perPlatformProvider: null });
    expect(
      turnConcurrencyLimits({
        CHAT_MAX_CONCURRENT_TURNS_PER_ORG: "0",
        CHAT_MAX_CONCURRENT_TURNS_PER_PLATFORM_PROVIDER: "1.5",
      })
    ).toMatchObject({ perOrganization: null, perPlatformProvider: 200 });
  });

  it("reads the queue wait, allowing 0 and capping it at a minute", () => {
    expect(turnConcurrencyLimits({ CHAT_TURN_QUEUE_WAIT_MS: "0" }).queueWaitMs).toBe(0);
    expect(turnConcurrencyLimits({ CHAT_TURN_QUEUE_WAIT_MS: "900000" }).queueWaitMs).toBe(60_000);
    expect(turnConcurrencyLimits({ CHAT_TURN_QUEUE_WAIT_MS: "-1" }).queueWaitMs).toBe(15_000);
  });
});

describe("turnConcurrencyScopes", () => {
  const limits = { perOrganization: 5, perPlatformProvider: 100, queueWaitMs: 0 };

  it("counts a platform turn against its org and the shared provider key", () => {
    expect(
      turnConcurrencyScopes(
        { organizationId: ORG, provider: "anthropic", credentialKind: "platform" },
        limits
      )
    ).toEqual([
      { key: "org:org-1", limit: 5 },
      { key: "platform:anthropic", limit: 100 },
    ]);
  });

  it("counts a BYOK turn against its org only", () => {
    expect(
      turnConcurrencyScopes(
        { organizationId: ORG, provider: "openai", credentialKind: "api_key" },
        limits
      )
    ).toEqual([{ key: "org:org-1", limit: 5 }]);
  });

  it("takes no slot for a Member's own CLI subscription", () => {
    expect(
      turnConcurrencyScopes(
        { organizationId: ORG, provider: "anthropic", credentialKind: "local_subscription" },
        limits
      )
    ).toEqual([]);
  });
});

function fakeSlots(results: Array<string | null | Error>) {
  const acquire = vi.fn(async () => {
    const next = results.shift() ?? null;
    if (next instanceof Error) throw next;
    return next;
  });
  const release = vi.fn(async () => true);
  return { db: { acquireTurnConcurrency: acquire, releaseTurnConcurrency: release }, acquire, release };
}

const scopes = [{ key: "org:org-1", limit: 1 }];

describe("admitTurnConcurrency", () => {
  it("admits at once when a slot is free, and releases it exactly once", async () => {
    const { db, release } = fakeSlots(["lease-1"]);
    const slot = await admitTurnConcurrency({ db, scopes });
    expect(slot.status).toBe("admitted");
    if (slot.status !== "admitted") return;
    await slot.release();
    await slot.release();
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith("lease-1");
  });

  it("waits in the queue until a slot frees", async () => {
    const { db, acquire } = fakeSlots([null, null, "lease-2"]);
    let now = 0;
    const slot = await admitTurnConcurrency({
      db,
      scopes,
      clock: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      random: () => 0.5,
    });
    expect(slot.status).toBe("admitted");
    expect(acquire).toHaveBeenCalledTimes(3);
  });

  it("answers busy with a retry hint once the queue wait runs out", async () => {
    const { db } = fakeSlots([]);
    let now = 0;
    const slot = await admitTurnConcurrency({
      db,
      scopes,
      maxWaitMs: 5_000,
      clock: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      random: () => 0.5,
    });
    expect(slot).toEqual({ status: "busy", retryAfterMs: 6_000 });
    expect(now).toBeLessThanOrEqual(5_000);
  });

  it("fails open when the slot store errors", async () => {
    const { db } = fakeSlots([new Error("relation does not exist")]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const slot = await admitTurnConcurrency({ db, scopes });
    expect(slot.status).toBe("admitted");
    error.mockRestore();
  });

  it("does not touch the store when there is nothing to count", async () => {
    const { db, acquire } = fakeSlots([]);
    await expect(admitTurnConcurrency({ db, scopes: [] })).resolves.toMatchObject({
      status: "admitted",
    });
    expect(acquire).not.toHaveBeenCalled();
  });
});

describe("queueDelayMs", () => {
  it("grows to a 3s step and never polls in lockstep", () => {
    expect(queueDelayMs(0, () => 0)).toBe(125);
    expect(queueDelayMs(0, () => 1)).toBe(250);
    expect(queueDelayMs(10, () => 0)).toBe(1_500);
    expect(queueDelayMs(10, () => 1)).toBe(3_000);
  });
});

describe("turnOverloadOf", () => {
  const none = () => null;
  it("names a full queue busy and a provider refusal rate_limited", () => {
    expect(turnOverloadOf(new TurnBusyError(4_500), none)).toEqual({
      code: "busy",
      retryAfterMs: 4_500,
    });
    expect(turnOverloadOf(new Error("429"), () => ({ retryAfterMs: 2_000 }))).toEqual({
      code: "rate_limited",
      retryAfterMs: 2_000,
    });
    expect(turnOverloadOf(new Error("boom"), none)).toBeNull();
  });
});
