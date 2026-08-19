import type { BudgetEnforcement } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

import { alertKeys, signalHealth } from "./health";

/**
 * Pre-turn budget check. Over budget: raises one refresh-while-active Alert
 * per org; under budget (with a limit configured): auto-resolves it. Fails
 * open, accounting problems must never take the assistant down.
 */
export async function checkOrgBudget(
  db: Db,
  organizationId: string
): Promise<{ overBudget: boolean; enforcement: BudgetEnforcement }> {
  try {
    const budget = await db.getOrgBudget(organizationId);
    if (budget?.dailyTokenLimit == null && budget?.dailyEuroLimit == null) {
      return { overBudget: false, enforcement: "notify" };
    }
    // The two ledger reads are independent, one round trip of wall-clock,
    // not two, on the pre-token path.
    const [usedTokens, usedEur] = await Promise.all([
      budget.dailyTokenLimit != null
        ? db.getOrgTokensUsedToday(organizationId)
        : Promise.resolve(0),
      budget.dailyEuroLimit != null
        ? db.getOrgCostUsedToday(organizationId)
        : Promise.resolve(0),
    ]);
    const reasons: string[] = [];
    let overBudget = false;
    if (budget.dailyTokenLimit != null && usedTokens >= budget.dailyTokenLimit) {
      overBudget = true;
      reasons.push(
        `${usedTokens.toLocaleString("en-US")} of ${budget.dailyTokenLimit.toLocaleString("en-US")} tokens`
      );
    }
    if (budget.dailyEuroLimit != null && usedEur >= budget.dailyEuroLimit) {
      overBudget = true;
      reasons.push(
        `€${usedEur.toFixed(2)} of €${budget.dailyEuroLimit.toFixed(2)}`
      );
    }
    const key = alertKeys.budget(organizationId);
    await signalHealth(
      db,
      organizationId,
      overBudget
        ? {
            key,
            healthy: false,
            alert: {
              type: "system",
              title: "Daily AI budget reached",
              detail: `Assistants used ${reasons.join(" and ")} today (UTC).${
                budget.enforcement === "block"
                  ? " New AI answers are paused until the window resets."
                  : " Answers continue normally (notify-only enforcement)."
              }`,
            },
          }
        : { key, healthy: true },
      "budget"
    );
    return { overBudget, enforcement: budget.enforcement };
  } catch (error) {
    console.error("[runtime] budget check failed:", error);
    return { overBudget: false, enforcement: "notify" };
  }
}
