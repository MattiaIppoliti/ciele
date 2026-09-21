import type {
  AiUsageInput,
  UsageSpenders,
  UsageSurface,
} from "@agent-hub/core";
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
 * Which surface a turn's credits belong to, and who spent them (#849).
 *
 * Pure, and here rather than inline in the turn, because it is a policy with
 * four rules worth pinning: the caller's declared surface wins (only it knows
 * an unattended Routine is driving what otherwise looks exactly like a Member's
 * Teammate chat); the subject's surface is the default; the Member comes from
 * the same `keyResolution` that decides whose personal subscription may run;
 * and every absent identity is null rather than undefined, so the two data-layer
 * adapters cannot disagree about what "nobody" is.
 */
export function turnUsageAttribution(input: {
  /** What the turn worked out for itself from its subject. */
  subjectSurface: UsageSurface;
  teammateId?: string | null;
  memberId?: string | null;
  declared?: {
    surface?: UsageSurface;
    routineId?: string | null;
    apiKeyId?: string | null;
  };
}): { surface: UsageSurface; spenders: UsageSpenders } {
  return {
    surface: input.declared?.surface ?? input.subjectSurface,
    spenders: {
      teammateId: input.teammateId ?? null,
      memberId: input.memberId ?? null,
      routineId: input.declared?.routineId ?? null,
      apiKeyId: input.declared?.apiKeyId ?? null,
      // Null, not absent. The Flow is only known once one has answered, so the
      // caller fills it in at row-build time; leaving the key out here would
      // make this the one identity the rule above does not hold for.
      flowId: null,
    },
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
