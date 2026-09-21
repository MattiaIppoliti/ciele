import { afterEach, describe, expect, it } from "vitest";
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
