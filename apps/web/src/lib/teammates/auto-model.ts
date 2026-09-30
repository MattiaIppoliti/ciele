import {
  autoModelFromEvaluations,
  modelSelector,
  type EvaluationCandidate,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import type { ChatModelOption } from "@agent-hub/agent/client";

/** The picker's value, and what the composer sends, for "Auto". */
export const AUTO_MODEL = "auto";

/**
 * One model, whatever source it would run on: `modelSelector` with the source
 * dropped, so an option on a Gateway source still names the catalogue model.
 */
export const modelKey = (ref: Pick<EvaluationCandidate, "provider" | "modelId">) =>
  modelSelector({ provider: ref.provider, modelId: ref.modelId });

/**
 * What "Auto" asks this turn: the best model of the Organization's newest
 * answer-stage Eval among the ones this chat can ask right now, or null for
 * "the configured model". Read on the caller's own session, so only Eval runs
 * the Member can read decide it. The page asks to describe the choice and the
 * chat route asks again to apply it, so the browser never names the model.
 */
export async function resolveAutoModel(
  db: Db,
  organizationId: string,
  askable: readonly ChatModelOption[]
): Promise<ChatModelOption | null> {
  const byKey = new Map(
    askable.filter((option) => !option.unavailable).map((option) => [modelKey(option), option])
  );
  if (byKey.size === 0) return null;
  const runs = await db.table("evaluationRuns").list({ organizationId });
  const pick = autoModelFromEvaluations(runs, (candidate) => byKey.has(modelKey(candidate)));
  return pick ? (byKey.get(modelKey(pick)) ?? null) : null;
}

/** The line under "Auto" in the picker. */
export const AUTO_MODEL_DESCRIPTION = "Balances speed, effort, and cost.";
