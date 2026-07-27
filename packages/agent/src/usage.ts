import type { AiUsageInput } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

/**
 * Token accounting helpers for the AI usage ledger.
 *
 * The AI SDK reports usage in two shapes: flat numbers on call results
 * ({ inputTokens: 12, outputTokens: 3 }) and nested objects at the model layer
 * ({ inputTokens: { total, … } }). The ledger stores flat totals; reading is
 * deliberately defensive — a provider that omits usage must never break a
 * turn, it just meters zero.
 */
function tokenCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const total = (value as { total?: unknown } | null | undefined)?.total;
  return typeof total === "number" && Number.isFinite(total) ? total : 0;
}

export function usageTotals(usage: unknown): {
  inputTokens: number;
  outputTokens: number;
} {
  const u = usage as
    | { inputTokens?: unknown; outputTokens?: unknown }
    | null
    | undefined;
  return {
    inputTokens: tokenCount(u?.inputTokens),
    outputTokens: tokenCount(u?.outputTokens),
  };
}

/**
 * The one way runtime code writes the ledger: isolated so losing accounting
 * never breaks the work that was already done (a turn, an eval, a pass).
 */
export async function meterUsage(db: Db, rows: AiUsageInput[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await db.recordAiUsage(rows);
  } catch (error) {
    console.error("[runtime] usage-ledger persist failed:", error);
  }
}
