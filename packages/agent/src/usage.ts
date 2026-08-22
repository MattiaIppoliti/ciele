import type { AiUsageInput } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import type { UsageEvent } from "./types";

/**
 * Token accounting helpers for the AI usage ledger.
 *
 * The AI SDK reports usage in two shapes: flat numbers on call results
 * ({ inputTokens: 12, outputTokens: 3 }) and nested objects at the model layer
 * ({ inputTokens: { total, … } }). The ledger stores flat totals; reading is
 * deliberately defensive, a provider that omits usage must never break a
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
 * Record a model stream's token usage. Both turn phases end this way, and
 * neither may fail for it: a provider (or a test mock) that reports no usage
 * still produced a reply, and losing the accounting must never lose the work.
 */
export async function recordStreamUsage(
  totalUsage: PromiseLike<unknown>,
  recordUsage?: (usage: { inputTokens: number; outputTokens: number }) => void
): Promise<void> {
  try {
    recordUsage?.(usageTotals(await totalUsage));
  } catch {
    // Either the provider never resolved a usage figure, or the recorder
    // itself threw. Both are accounting failures, and neither may undo a
    // reply that has already been written.
  }
}

/**
 * Rolls a turn's per-call usage events into the single turn-level telemetry
 * record: total tokens in/out, and the provider/model that actually answered
 * (the last generative call, post cross-provider fallback). The deterministic
 * no-model path meters zero with a null provider/model.
 */
export function summarizeTurnUsage(usage: UsageEvent[]): {
  inputTokens: number;
  outputTokens: number;
  provider: UsageEvent["provider"] | null;
  modelId: string | null;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let answered: UsageEvent | null = null;
  for (const u of usage) {
    inputTokens += u.inputTokens;
    outputTokens += u.outputTokens;
    if (u.stage === "generate") answered = u;
  }
  const picked = answered ?? usage.at(-1) ?? null;
  return {
    inputTokens,
    outputTokens,
    provider: picked?.provider ?? null,
    modelId: picked?.modelId ?? null,
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
