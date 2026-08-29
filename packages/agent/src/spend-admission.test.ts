import { describe, expect, it } from "vitest";
import { getMockDb } from "@agent-hub/db";

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
