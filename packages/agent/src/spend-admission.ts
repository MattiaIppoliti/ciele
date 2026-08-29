import type { AiCredentialKind, AiUsageInput } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

import { checkOrgBudget } from "./budget-gate";
import { getEnterpriseCapabilities } from "./ee";
import { meterUsage } from "./usage";

export type AiConnectionKind = "platform" | "byok";

/** Map provider credential provenance onto the two plan-meter buckets. */
export function spendConnectionKinds(
  credentialKind: AiCredentialKind | null | undefined,
): AiConnectionKind[] {
  if (!credentialKind) return [];
  return [credentialKind === "platform" ? "platform" : "byok"];
}

export interface AiSpendCapacity {
  maxTokens: number;
  maxEur: number;
}

export const CONVERSATION_SPEND_CAPACITY: AiSpendCapacity = {
  maxTokens: 32_000,
  maxEur: 0.5,
};

export interface AiSpendBlock {
  reason: "budget" | "activation" | "usage";
  /** Policy-provided detail; each surface decides how to present it. */
  detail: string;
}

export interface AiSpendAdmission {
  blocked: AiSpendBlock | null;
  /** Persist actual usage, atomically consuming a hard-budget reservation. */
  settle(rows: AiUsageInput[]): Promise<void>;
  /** Release unused capacity; safe to call more than once. */
  release(): Promise<void>;
}

/**
 * One admission lifecycle for an interactive model-backed turn. Budget checks fail
 * open until a hard ceiling needs a reservation; reservation failure then
 * fails closed. Activation and plan-meter failures retain their established
 * fail-open posture.
 */
export async function admitAiSpend(options: {
  db: Db;
  organizationId: string;
  connectionKinds: readonly AiConnectionKind[];
  capacity: AiSpendCapacity;
}): Promise<AiSpendAdmission> {
  const { db, organizationId, capacity } = options;
  const connectionKinds = [...new Set(options.connectionKinds)];
  const [budget, activation, usages] = await Promise.all([
    checkOrgBudget(db, organizationId),
    getEnterpriseCapabilities()
      .activation.getActivation(organizationId)
      .catch((error) => {
        console.error(
          "[spend-admission] activation check failed (failing open):",
          error,
        );
        return { state: "active" as const };
      }),
    Promise.all(
      connectionKinds.map((connectionKind) =>
        getEnterpriseCapabilities()
          .metering.checkUsage({
            organizationId,
            connectionKind,
            resource: "ai",
          })
          .catch((error) => {
            console.error(
              "[spend-admission] usage check failed (failing open):",
              error,
            );
            return { outcome: "allow" as const };
          }),
      ),
    ),
  ]);

  let blocked: AiSpendBlock | null = null;
  if (budget.overBudget && budget.enforcement === "block") {
    blocked = { reason: "budget", detail: "Daily AI budget reached" };
  } else if (activation.state === "pending") {
    blocked = { reason: "activation", detail: activation.visitorMessage };
  } else {
    const usage = usages.find((item) => item.outcome === "block");
    if (usage?.outcome === "block") {
      blocked = { reason: "usage", detail: usage.message };
    }
  }

  let reservationId: string | null = null;
  if (
    !blocked &&
    connectionKinds.length > 0 &&
    budget.limited &&
    budget.enforcement === "block"
  ) {
    try {
      const now = new Date();
      reservationId = await db.reserveOrgBudget({
        organizationId,
        maxTokens: capacity.maxTokens,
        maxEur: capacity.maxEur,
        observedCostEur: budget.usedEur,
        now: now.toISOString(),
        expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
      });
      if (!reservationId) {
        blocked = { reason: "budget", detail: "Daily AI budget reached" };
      }
    } catch (error) {
      console.error(
        "[spend-admission] hard-budget reservation failed (failing closed):",
        error,
      );
      blocked = {
        reason: "budget",
        detail: "Daily AI budget admission unavailable",
      };
    }
  }

  let settlementAttempted = false;
  let released = false;
  const release = async () => {
    if (!reservationId || settlementAttempted || released) return;
    released = true;
    await db.releaseOrgBudgetReservation(reservationId).catch((error) =>
      console.error("[spend-admission] reservation release failed:", error),
    );
  };

  return {
    blocked,
    release,
    settle: async (rows) => {
      if (blocked) return;
      if (!reservationId) {
        await meterUsage(db, rows);
        return;
      }
      settlementAttempted = true;
      try {
        const settled = await db.settleOrgBudgetReservation(reservationId, rows);
        if (!settled) {
          console.error("[spend-admission] reservation settlement was rejected");
        }
      } catch (error) {
        // Do not release after a failed settlement: the reservation expires,
        // preserving the hard ceiling while accounting is uncertain.
        console.error("[spend-admission] reservation settlement failed:", error);
      }
    },
  };
}
