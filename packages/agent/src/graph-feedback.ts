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
import { graphUsageInput, reconcileGraphDataset } from "./graph-sync";
import { alertKeys, signalHealth } from "./health";
import { enqueueGraphSyncJob } from "./jobs";
import {
  admitAiSpend,
  CONVERSATION_SPEND_CAPACITY,
} from "./spend-admission";

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
const GRAPH_DATASET_BATCH_SIZE = 5;

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
 * Nightly graph-learning pass: for one fair, rotating batch of active graph datasets,
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

  const datasets =
    typeof deps.db.claimActiveGraphDatasets === "function"
      ? await deps.db.claimActiveGraphDatasets(GRAPH_DATASET_BATCH_SIZE)
      : (await deps.db.listActiveGraphDatasets()).slice(0, GRAPH_DATASET_BATCH_SIZE);
  result.datasets = datasets.length;

  for (const { organizationId, collectionId } of datasets) {
    const key = alertKeys.graphWorker(organizationId);
    const admission = await admitAiSpend({
      db: deps.db,
      organizationId,
      connectionKinds: ["platform"],
      capacity: CONVERSATION_SPEND_CAPACITY,
    });
    const distill = !admission.blocked;
    try {
      // Repair stale worker inventory without replacing active graph nodes or
      // their learned weights. Missing/changed Concepts return to the normal
      // bounded job path, where each cognify call receives spend admission.
      const reconciliation = await reconcileGraphDataset(
        deps.db,
        collectionId,
        async (conceptId, jobId) => {
          await enqueueGraphSyncJob(
            { op: "ingest", collectionId, conceptId },
            { db: deps.db },
            { organizationId, jobId },
          );
        },
      );
      if (!reconciliation.complete) {
        await signalHealth(
          deps.db,
          organizationId,
          { key, healthy: true },
          "graph-learning",
        );
        continue;
      }
      const { weightedElements, boosted, demoted, usage } = await improveDataset(
        collectionId,
        { distill }
      );
      if (usage) {
        const row = await graphUsageInput(deps.db, collectionId, usage);
        await admission.settle(row ? [row] : []);
      }
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
    } finally {
      await admission.release();
    }
  }
  return result;
}
