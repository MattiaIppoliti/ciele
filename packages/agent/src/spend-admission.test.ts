import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiUsageInput } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { getMockDb } from "@agent-hub/db";
import {
  registerEnterpriseCapabilities,
  resetEnterpriseCapabilities,
} from "./ee";

import {
  CONVERSATION_SPEND_CAPACITY,
  admitAiSpend,
} from "./spend-admission";

describe("AI spend admission", () => {
  it("reserves the full declared capacity and blocks a concurrent admission that cannot fit", async () => {
    const db = getMockDb();
    const organizationId = `spend-admission-${crypto.randomUUID()}`;
    await db.setOrgBudget(organizationId, {
      dailyTokenLimit: 40_000,
      dailyEuroLimit: null,
      enforcement: "block",
    });

    const first = await admitAiSpend({
      db,
      organizationId,
      connectionKinds: ["platform"],
      capacity: CONVERSATION_SPEND_CAPACITY,
    });
    expect(first.blocked).toBeNull();

    const second = await admitAiSpend({
      db,
      organizationId,
      connectionKinds: ["platform"],
      capacity: CONVERSATION_SPEND_CAPACITY,
    });
    expect(second.blocked?.reason).toBe("budget");

    await first.release();
    const afterRelease = await admitAiSpend({
      db,
      organizationId,
      connectionKinds: ["platform"],
      capacity: CONVERSATION_SPEND_CAPACITY,
    });
    expect(afterRelease.blocked).toBeNull();
    await afterRelease.release();
  });

});

describe("spend accounting failures", () => {
  afterEach(() => {
    resetEnterpriseCapabilities();
    vi.restoreAllMocks();
  });

  function failingSink() {
    return vi.spyOn(console, "error").mockImplementation(() => { throw new Error("sink down"); });
  }

  async function limitedDb() {
    const db = getMockDb();
    const organizationId = `spend-failure-${crypto.randomUUID()}`;
    await db.setOrgBudget(organizationId, {
      dailyTokenLimit: 40_000, dailyEuroLimit: null, enforcement: "block",
    });
    return { db, organizationId };
  }

  it("keeps activation and usage checks fail-open and excludes their error contents", async () => {
    const errors = failingSink();
    registerEnterpriseCapabilities({
      activation: { getActivation: vi.fn().mockRejectedValue(new Error("private activation data")) },
      metering: {
        checkUsage: vi.fn().mockRejectedValue(new Error("private usage data")),
        getUsageLimits: async () => null,
      },
    });
    const admission = await admitAiSpend({
      db: getMockDb(), organizationId: "spend-check-failures", connectionKinds: ["platform"],
      capacity: CONVERSATION_SPEND_CAPACITY,
    });
    expect(admission.blocked).toBeNull();
    expect(errors.mock.calls.map(([record]) => JSON.parse(record).event)).toEqual([
      "runtime.spend.activation", "runtime.spend.usage_check",
    ]);
    expect(JSON.stringify(errors.mock.calls)).not.toContain("private");
  });

  it("keeps a failed hard-budget reservation closed even when logging fails", async () => {
    const errors = failingSink();
    const { db, organizationId } = await limitedDb();
    const settle = vi.fn<Db["settleOrgBudgetReservation"]>();
    const admission = await admitAiSpend({
      db: { ...db, reserveOrgBudget: vi.fn().mockRejectedValue(new Error("private reservation data")), settleOrgBudgetReservation: settle },
      organizationId, connectionKinds: ["platform"], capacity: CONVERSATION_SPEND_CAPACITY,
    });
    expect(admission.blocked).toEqual({ reason: "budget", detail: "Daily AI budget admission unavailable" });
    await admission.settle([]);
    expect(settle).not.toHaveBeenCalled();
    expect(JSON.parse(errors.mock.calls[0]![0])).toMatchObject({ event: "runtime.spend.reserve", organizationId });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("private reservation data");
  });

  it("keeps release best-effort and does not release twice when storage and logging fail", async () => {
    const errors = failingSink();
    const { db, organizationId } = await limitedDb();
    const release = vi.fn().mockRejectedValue(new Error("private release data"));
    const admission = await admitAiSpend({
      db: { ...db, releaseOrgBudgetReservation: release }, organizationId,
      connectionKinds: ["platform"], capacity: CONVERSATION_SPEND_CAPACITY,
    });
    await expect(admission.release()).resolves.toBeUndefined();
    await expect(admission.release()).resolves.toBeUndefined();
    expect(release).toHaveBeenCalledTimes(1);
    expect(JSON.parse(errors.mock.calls[0]![0])).toMatchObject({ event: "runtime.spend.release", organizationId });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("private release data");
  });

  it.each(["throws", "refuses"])("retains reserved capacity when settlement %s and logging fails", async (failure) => {
    const errors = failingSink();
    const { db, organizationId } = await limitedDb();
    const settle = vi.fn<Db["settleOrgBudgetReservation"]>();
    if (failure === "throws") settle.mockRejectedValue(new Error("private settlement data"));
    else settle.mockResolvedValue(false);
    const release = vi.fn<Db["releaseOrgBudgetReservation"]>();
    const admission = await admitAiSpend({
      db: { ...db, settleOrgBudgetReservation: settle, releaseOrgBudgetReservation: release },
      organizationId, connectionKinds: ["platform"], capacity: CONVERSATION_SPEND_CAPACITY,
    });
    const rows: AiUsageInput[] = [{
      organizationId, assistantId: null, stage: "generate", provider: "google",
      modelId: "gemini-2.5-flash", inputTokens: 10, outputTokens: 5,
    }];
    await expect(admission.settle(rows)).resolves.toBeUndefined();
    await admission.release();
    expect(settle).toHaveBeenCalledWith(expect.any(String), rows);
    expect(release).not.toHaveBeenCalled();
    expect(JSON.parse(errors.mock.calls[0]![0])).toMatchObject({ event: "runtime.spend.settle", organizationId, count: 1 });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("private settlement data");
  });
});

describe("funding a turn from a top-up balance (#851)", () => {
  // The registry is a process-global cell, deliberately, so it survives module
  // duplication in dev. That also means it survives vitest's module isolation:
  // a case that registers and does not reset changes what every later FILE in
  // the same worker sees.
  afterEach(() => resetEnterpriseCapabilities());

  const gateReturning = (outcome: unknown) => {
    registerEnterpriseCapabilities({
      metering: {
        checkUsage: async () => outcome as never,
        getUsageLimits: async () => null,
      },
    });
  };

  /** A db that records what the settle path actually wrote. */
  function watchingDb() {
    const db = getMockDb();
    const written: Record<string, unknown>[] = [];
    const watched = {
      ...db,
      async recordAiUsage(rows: Record<string, unknown>[]) {
        written.push(...rows);
        return db.recordAiUsage(rows as never);
      },
    };
    return { watched: watched as never, written };
  }

  const oneRow = (organizationId: string) => ({
    organizationId,
    assistantId: null,
    stage: "generate" as const,
    provider: "google" as const,
    modelId: "gemini-2.5-flash",
    credentialKind: "platform" as const,
    // One million input tokens, so the snapshot is a round, checkable number
    // rather than a fraction of a credit.
    inputTokens: 1_000_000,
    outputTokens: 0,
  });

  it("stamps the pool and a price snapshot on every row it settles", async () => {
    gateReturning({ outcome: "allow", funding: "topup", balanceCredits: 250 });
    const { watched, written } = watchingDb();
    const organizationId = `topup-${crypto.randomUUID()}`;
    const admission = await admitAiSpend({
      db: watched,
      organizationId,
      connectionKinds: ["platform"],
      capacity: CONVERSATION_SPEND_CAPACITY,
    });
    expect(admission.blocked).toBeNull();

    await admission.settle([oneRow(organizationId)]);

    expect(written).toHaveLength(1);
    expect(written[0].funding).toBe("topup");
    // The balance is derived from these rows, so the price is snapshotted here
    // rather than recomputed later from a rate that may have been corrected.
    expect(written[0].creditsMicro).toBeGreaterThan(0);
    expect(Number.isInteger(written[0].creditsMicro)).toBe(true);
  });

  it("leaves a plan-funded row unpriced, as it always was", async () => {
    gateReturning({ outcome: "allow" });
    const { watched, written } = watchingDb();
    const organizationId = `plan-${crypto.randomUUID()}`;
    const admission = await admitAiSpend({
      db: watched,
      organizationId,
      connectionKinds: ["platform"],
      capacity: CONVERSATION_SPEND_CAPACITY,
    });

    await admission.settle([oneRow(organizationId)]);

    expect(written).toHaveLength(1);
    // A plan meter is a fraction of an allowance and follows the rate table,
    // so it is priced at read time and stores nothing.
    expect(written[0]).not.toHaveProperty("creditsMicro");
    expect(written[0]).not.toHaveProperty("funding");
  });

  it("does not draw on the pool when the gate never offered it", async () => {
    gateReturning({
      outcome: "block",
      message: "unavailable",
      resource: "ai",
      window: "week",
      resetsAt: "2026-09-20T00:00:00.000Z",
    });
    const { watched, written } = watchingDb();
    const organizationId = `blocked-${crypto.randomUUID()}`;
    const admission = await admitAiSpend({
      db: watched,
      organizationId,
      connectionKinds: ["platform"],
      capacity: CONVERSATION_SPEND_CAPACITY,
    });
    expect(admission.blocked?.reason).toBe("usage");
    // A blocked turn settles nothing at all, so there is no row to fund.
    await admission.settle([oneRow(organizationId)]);
    expect(written).toHaveLength(0);
  });
});
