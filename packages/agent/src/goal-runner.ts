import type { AssistantGoal } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { runAssistantChat } from "./engine";
import { buildKnowledgeSearcher } from "./retrieval";
import { createTurnSession } from "./session";
import { gradeGoalReply, type GoalVerdict } from "./goals";
import { alertKeys, signalHealth } from "./health";
import { meterUsage } from "./usage";
import { getRuntimeHost } from "./host";

/**
 * The standing-goal re-verification loop (spec: nothing that passed once
 * goes unwatched). Each due goal runs headlessly through the real chat
 * engine against the assistant's latest Publication snapshot with fresh
 * empty history, no Conversation or messages are persisted; only the goal
 * ledger, the goal's last result, and the per-goal Alert change.
 */
export async function runDueGoalEvals(
  deps: { db: Db },
  options: { limit?: number; dueBefore?: string } = {}
): Promise<{ processed: number; failed: number }> {
  const { db } = deps;
  // Daily cadence with slack: a goal is due when its last run is older than
  // ~20h, so a drifting cron tick never skips a day.
  const dueBefore =
    options.dueBefore ?? new Date(Date.now() - 20 * 3_600_000).toISOString();
  const goals = await db.claimDueAssistantGoals({
    dueBefore,
    limit: options.limit ?? 10,
  });

  let failed = 0;
  for (const goal of goals) {
    const verdict = await evalGoal(db, goal);
    if (!verdict.pass) failed += 1;
  }
  return { processed: goals.length, failed };
}

async function evalGoal(db: Db, goal: AssistantGoal): Promise<GoalVerdict> {
  const started = Date.now();
  let verdict: GoalVerdict;
  try {
    verdict = await executeGoal(db, goal);
  } catch (error) {
    verdict = {
      pass: false,
      detail: `Eval error: ${error instanceof Error ? error.message : "unknown"}`,
    };
  }
  await finishRun(db, goal, verdict, Date.now() - started);
  return verdict;
}

async function executeGoal(db: Db, goal: AssistantGoal): Promise<GoalVerdict> {
  const publication = await db.getLatestPublication(goal.assistantId);
  if (!publication) {
    return {
      pass: false,
      detail:
        "The assistant has no Publication, goals verify what a live widget Visitor would get.",
    };
  }
  const config = publication.config;
  const assistant = {
    ...config.assistant,
    createdAt: publication.createdAt,
    updatedAt: publication.createdAt,
  };
  const connections = await db.listProviderConnections(
    assistant.organizationId
  );
  // The same retrieval port a widget Visitor gets, goals verify the
  // production path, Knowledge Engine choice included, not a bespoke
  // vector-only copy. No Conversation row exists for synthetic traffic.
  const searchKnowledge = buildKnowledgeSearcher({
    db,
    connections,
    assistant,
    collectionId: null,
    conversationId: null,
  });
  const platformPrompt = await getRuntimeHost().getPlatformSystemPrompt();

  const result = await runAssistantChat({
    assistant,
    platformPrompt,
    flows: config.flows,
    skills: config.skills ?? [],
    connections,
    message: goal.question,
    history: [],
    searchKnowledge,
    session: createTurnSession(`goal-${goal.id}`, {}),
    // Synthetic traffic has no page, so URL conditions stay unevaluatable, but
    // it does happen at a moment, so a scheduled flow is honored here too.
    routing: { now: new Date() },
    emit: () => {},
  });

  // Eval cost meters under its own stage, synthetic traffic never touches
  // conversations, Insights, or Improvements, but it does cost tokens.
  await meterUsage(
    db,
    result.usage.map((u) => ({
      organizationId: goal.organizationId,
      assistantId: goal.assistantId,
      stage: "goal_eval" as const,
      provider: u.provider,
      modelId: u.modelId,
      credentialKind: u.credentialKind,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
    }))
  );

  return gradeGoalReply(result.parts, goal.expectations);
}

async function finishRun(
  db: Db,
  goal: AssistantGoal,
  verdict: GoalVerdict,
  durationMs: number
): Promise<void> {
  try {
    await db.recordAssistantGoalRun(goal.id, {
      pass: verdict.pass,
      detail: verdict.detail,
      durationMs,
    });
  } catch (error) {
    console.error("[goal-runner] run persist failed:", error);
  }
  const key = alertKeys.goal(goal.id);
  if (verdict.pass) {
    await signalHealth(db, goal.organizationId, { key, healthy: true }, "goal-runner");
  } else {
    // goal.lastRunAt is the claim stamp (now), so the detail sticks to
    // status words, a timestamp here would lie.
    const previously =
      goal.lastResult === "pass"
        ? "Was passing on the previous run."
        : goal.lastResult === "fail"
          ? "Was already failing on the previous run."
          : "First run of this goal.";
    await signalHealth(
      db,
      goal.organizationId,
      {
        key,
        healthy: false,
        alert: {
          type: "system",
          title: `Standing goal failing: “${goal.question.slice(0, 80)}”`,
          detail: `${verdict.detail} ${previously}`,
        },
      },
      "goal-runner"
    );
  }
}
