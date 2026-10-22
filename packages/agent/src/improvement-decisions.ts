import {
  buildDedupQuestions,
  buildPriorityQuestions,
  PRIORITY_QUESTION_IDS,
  type OpenImprovement,
  type PriorityQuestionId,
  type ProviderConnection,
} from "@agent-hub/core";

import type { Db } from "@agent-hub/db";

import { decide, resolveDecisionModel } from "./decision-model";
import { withPostTurnMasking } from "./pii-masking";

/**
 * The Improvements board's decisions (#959), as one call the host can make.
 *
 * It exists as a barrel export rather than a deep import because `ops` speaks
 * core, db and zod only and cannot reach a model, so the host binds it as an
 * `OperationPorts` port. It returns the raw answers on purpose: which item to
 * merge into and what priority to give are derivations in `@agent-hub/core`,
 * and keeping them there is what lets the weights and thresholds be read and
 * changed in one place instead of inside a host.
 */
export interface TriageDecisionResult {
  dedup: {
    answers: Readonly<Record<string, { type: "boolean"; probability: number }>>;
    confidence: Readonly<Record<string, number>>;
  };
  priority: Readonly<
    Record<PriorityQuestionId, { type: "score"; score: number }>
  >;
  calibrated: boolean;
}

/**
 * Returns `null` when there is no decision backend, which is how the routine
 * knows to dedup the way it did before rather than to read "no match" as "a
 * new problem". Errors propagate to the caller, which already swallows them:
 * an unattended routine that stops filing because a backend had a bad minute
 * is a worse outcome than one filing the way it filed last month.
 */
export async function runTriageDecision(input: {
  evidence: { title: string; question: string; answer: string };
  candidates: readonly OpenImprovement[];
  connections: ProviderConnection[];
  /** Reads the Assistant's PII masking guardrail and the transcript (#1080). */
  db: Db;
  /** Where the evidence came from: its words go out masked as its turns did. */
  conversation: { id: string; assistantId: string | null };
}): Promise<TriageDecisionResult | null> {
  // Org connections only. A triage run is unattended work and is nobody's
  // personal use, the same rule the Routines effort settled (#772).
  const resolved = resolveDecisionModel("anthropic", input.connections, {});
  if (!resolved) return null;

  // The evidence is a Visitor's question and the answer they flagged, and
  // the candidates' titles were cut from questions like it (#1080).
  const decision = await withPostTurnMasking(
    input.db,
    input.conversation.assistantId,
    () => input.db.listMessages(input.conversation.id),
    () =>
      decide(resolved, {
        state: "",
        questions: {
          ...buildDedupQuestions(input.evidence, input.candidates),
          ...buildPriorityQuestions(input.evidence),
        },
      })
  );

  const answers = decision.answers as Record<string, unknown>;
  const dedupAnswers: Record<string, { type: "boolean"; probability: number }> = {};
  for (const candidate of input.candidates) {
    const answer = answers[candidate.id];
    if (answer && (answer as { type?: string }).type === "boolean") {
      dedupAnswers[candidate.id] = answer as { type: "boolean"; probability: number };
    }
  }
  const priority = Object.fromEntries(
    PRIORITY_QUESTION_IDS.map((id) => [id, answers[id]])
  ) as TriageDecisionResult["priority"];

  return {
    dedup: { answers: dedupAnswers, confidence: { ...decision.confidence } },
    priority,
    calibrated: decision.calibrated,
  };
}
