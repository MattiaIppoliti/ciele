import { describe, expect, it } from "vitest";
import type { Role } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import type { OperationContext } from "./operation";
import { setOrgBudgetOp } from "./organization";

/**
 * A Settings mutation that kept its rules in a server action until it became
 * an operation: the daily AI budget.
 */

const ctx = (organizationId = DEMO_ORG.id): OperationContext => ({
  organizationId,
  userId: DEMO_MEMBER.userId,
  role: "admin" as Role,
  db: getMockDb(),
});

describe("setOrgBudgetOp", () => {
  it("stores whole tokens and euros to the cent", async () => {
    const input = setOrgBudgetOp.input.parse({
      dailyTokenLimit: 1500.7,
      dailyEuroLimit: 12.345,
      enforcement: "block",
    });
    const budget = await setOrgBudgetOp.run(ctx(), input);
    expect(budget).toMatchObject({
      dailyTokenLimit: 1500,
      dailyEuroLimit: 12.35,
      enforcement: "block",
    });
  });

  it("lets either limit be absent and refuses one that is not positive", () => {
    expect(
      setOrgBudgetOp.input.safeParse({
        dailyTokenLimit: null,
        dailyEuroLimit: null,
        enforcement: "notify",
      }).success,
    ).toBe(true);
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const parsed = setOrgBudgetOp.input.safeParse({
        dailyTokenLimit: bad,
        dailyEuroLimit: null,
        enforcement: "notify",
      });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe(
        "The daily token limit must be a positive number.",
      );
    }
    expect(
      setOrgBudgetOp.input.safeParse({
        dailyTokenLimit: null,
        dailyEuroLimit: null,
        enforcement: "sometimes",
      }).success,
    ).toBe(false);
  });

  it("is an admin's setting", () => {
    expect(setOrgBudgetOp.capability).toBe("manageMembers");
  });
});
