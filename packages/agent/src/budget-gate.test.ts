import { describe, expect, it, vi } from "vitest";
import type { Db } from "@agent-hub/db";
import { checkOrgBudget } from "./budget-gate";

/**
 * The pre-turn budget gate: no configured limit → allow without ledger reads,
 * a reached limit → overBudget + one keyed Alert, recovery → auto-resolve,
 * and any accounting failure fails open (assistants keep answering).
 */

function makeDb(overrides: Partial<Record<keyof Db, unknown>> = {}) {
  return {
    getOrgBudget: vi.fn(async () => null),
    getOrgTokensUsedToday: vi.fn(async () => 0),
    getOrgCostUsedToday: vi.fn(async () => 0),
    raiseAlert: vi.fn(async () => ({})),
    resolveAlertsByKey: vi.fn(async () => {}),
    ...overrides,
  } as unknown as Db;
}

describe("checkOrgBudget", () => {
  it("allows and reads no ledgers when no limit is configured", async () => {
    const db = makeDb();
    const result = await checkOrgBudget(db, "org-1");
    expect(result).toEqual({ overBudget: false, enforcement: "notify" });
    expect(vi.mocked(db.getOrgTokensUsedToday)).not.toHaveBeenCalled();
    expect(vi.mocked(db.getOrgCostUsedToday)).not.toHaveBeenCalled();
    expect(vi.mocked(db.raiseAlert)).not.toHaveBeenCalled();
  });

  it("blocks at the token limit and raises the keyed budget Alert", async () => {
    const db = makeDb({
      getOrgBudget: vi.fn(async () => ({
        dailyTokenLimit: 1000,
        dailyEuroLimit: null,
        enforcement: "block",
      })),
      getOrgTokensUsedToday: vi.fn(async () => 1000),
    });
    const result = await checkOrgBudget(db, "org-1");
    expect(result).toEqual({ overBudget: true, enforcement: "block" });
    expect(vi.mocked(db.raiseAlert)).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        sourceKey: "budget:org-1",
        title: "Daily AI budget reached",
        detail: expect.stringContaining("paused"),
      })
    );
    // Only the configured ledger is read: the euro path stays cold.
    expect(vi.mocked(db.getOrgCostUsedToday)).not.toHaveBeenCalled();
  });

  it("auto-resolves the Alert when back under a configured limit", async () => {
    const db = makeDb({
      getOrgBudget: vi.fn(async () => ({
        dailyTokenLimit: 1000,
        dailyEuroLimit: null,
        enforcement: "notify",
      })),
      getOrgTokensUsedToday: vi.fn(async () => 10),
    });
    const result = await checkOrgBudget(db, "org-1");
    expect(result).toEqual({ overBudget: false, enforcement: "notify" });
    expect(vi.mocked(db.resolveAlertsByKey)).toHaveBeenCalledWith(
      "org-1",
      "budget:org-1"
    );
  });

  it("fails open when the accounting read throws", async () => {
    const db = makeDb({
      getOrgBudget: vi.fn(async () => {
        throw new Error("ledger down");
      }),
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const result = await checkOrgBudget(db, "org-1");
    expect(result).toEqual({ overBudget: false, enforcement: "notify" });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
