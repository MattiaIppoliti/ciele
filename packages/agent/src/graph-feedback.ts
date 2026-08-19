/**
 * The graph learning loop (ADR-0017 / #389): visitor and member feedback on a
 * graph-served answer flows back to the worker as a 1–5 score, and a nightly
 * pass turns those scores into re-weighted retrieval.
 *
 * A graph-served answer recorded its Retrieval Trace QA id in the conversation
 * session state (`graphQa[messageId]`, written by #388). `forwardGraphFeedback`
 * resolves that trace from a message id and scores it; answers that were served
 * by the vector engine have no trace and are left untouched.
 *
 * Everything here is **inert without a graph worker** and **fail-soft**: a
 * worker outage never blocks the visitor's feedback write or the escalation,
 * it raises an auto-resolving Alert instead (the standard health idiom).
 */

import type { Conversation } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import {
  type GraphFeedbackScore,
  improveDataset,
  isGraphWorkerConfigured,
  sendFeedback,
} from "./graph-worker";
import { meterGraphUsage } from "./graph-sync";
import { alertKeys, signalHealth } from "./health";

/** 👍 → 5, 👎 → 1 on cognee's 1–5 scale. */
export function feedbackScore(vote: 1 | -1): GraphFeedbackScore {
  return vote === 1 ? 5 : 1;
}

/** The graph Retrieval Trace QA id recorded for a message, or null. */
function graphQaId(conversation: Conversation | null, messageId: string): string | null {
  const map = conversation?.sessionState?.graphQa as
    | Record<string, string>
    | undefined;
  return map?.[messageId] ?? null;
}

const workerUnreachableAlert = {
  type: "integration" as const,
  title: "Graph knowledge service unreachable",
  detail:
    "The graph knowledge worker could not be reached; graph feedback and learning are paused until it recovers. Answers continue via vector search.",
};

/**
 * Forwards a score for one graph-served answer. No-op when the worker is
 * unconfigured or the message was not graph-served. Never throws, a worker
 * error raises an auto-resolving Alert and returns.
 */
export async function forwardGraphFeedback(opts: {
  db: Db;
  organizationId: string;
  messageId: string;
  score: GraphFeedbackScore;
  text?: string;
}): Promise<void> {
  if (!isGraphWorkerConfigured()) return;
  const conversation = await opts.db
    .getConversationForMessage(opts.messageId)
    .catch((error) => {
      // Fail-soft, but a read error is a genuine fault (not a vector answer),
      // log it rather than silently treating it as "nothing to forward".
      console.error("[graph-feedback] conversation lookup failed:", error);
      return null;
    });
  const qaId = graphQaId(conversation, opts.messageId);
  if (!conversation || !conversation.collectionId || !qaId) return;

  const key = alertKeys.graphWorker(opts.organizationId);
  try {
    await sendFeedback(conversation.collectionId, {
      sessionId: conversation.id,
      qaId,
      score: opts.score,
      text: opts.text,
    });
    await signalHealth(opts.db, opts.organizationId, { key, healthy: true }, "graph-feedback");
  } catch (error) {
    console.error("[graph-feedback] forward failed:", error);
    await signalHealth(
      opts.db,
      opts.organizationId,
      { key, healthy: false, alert: workerUnreachableAlert },
      "graph-feedback"
    );
  }
}

/** Distillation is the LLM stage of `improve`; gate it on the org's daily token
 * budget so learning never produces a surprise bill. No limit configured → on. */
async function distillationAllowed(db: Db, organizationId: string): Promise<boolean> {
  const budget = await db.getOrgBudget(organizationId);
  if (budget?.dailyTokenLimit == null) return true;
  const used = await db.getOrgTokensUsedToday(organizationId);
  return used < budget.dailyTokenLimit;
}

export interface GraphLearningResult {
  datasets: number;
  weightedElements: number;
  /** Edges whose feedback weight moved above neutral (reinforced by 👍). */
  boosted: number;
  /** Edges whose feedback weight moved below neutral (penalized by 👎). */
  demoted: number;
  distilled: number;
  failed: number;
}

/**
 * Nightly graph-learning pass: for every active graph dataset (cross-org),
 * applies feedback weights, the zero-LLM stage, always, and runs LLM
 * distillation only for orgs within their daily token budget. Per-org worker
 * failures raise an auto-resolving Alert and are counted, never thrown. Inert
 * without a graph worker.
 */
export async function runGraphLearning(
  deps: { db: Db }
): Promise<GraphLearningResult> {
  const result: GraphLearningResult = {
    datasets: 0,
    weightedElements: 0,
    boosted: 0,
    demoted: 0,
    distilled: 0,
    failed: 0,
  };
  if (!isGraphWorkerConfigured()) return result;

  const datasets = await deps.db.listActiveGraphDatasets();
  result.datasets = datasets.length;
  const distillByOrg = new Map<string, boolean>();

  for (const { organizationId, collectionId } of datasets) {
    if (!distillByOrg.has(organizationId)) {
      distillByOrg.set(organizationId, await distillationAllowed(deps.db, organizationId));
    }
    const distill = distillByOrg.get(organizationId) ?? false;
    const key = alertKeys.graphWorker(organizationId);
    try {
      const { weightedElements, boosted, demoted, usage } = await improveDataset(
        collectionId,
        { distill }
      );
      // Distillation is an LLM pass on the worker, meter what it reported
      // (`graph_cognify`); the pure weight pass reports no usage.
      if (usage) await meterGraphUsage(deps.db, collectionId, usage);
      result.weightedElements += weightedElements;
      result.boosted += boosted;
      result.demoted += demoted;
      if (distill) result.distilled += 1;
      await signalHealth(deps.db, organizationId, { key, healthy: true }, "graph-learning");
    } catch (error) {
      console.error("[graph-learning] improve failed:", error);
      result.failed += 1;
      await signalHealth(
        deps.db,
        organizationId,
        { key, healthy: false, alert: workerUnreachableAlert },
        "graph-learning"
      );
    }
  }
  return result;
}
