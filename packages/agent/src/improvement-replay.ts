import { z } from "zod";
import { messageText, thrownMessage } from "@agent-hub/core";
import type { ImprovementValidation } from "@agent-hub/core";
import type { JobHandler } from "./jobs";
import { runAssistantChat } from "./engine";
import { buildKnowledgeSearcher } from "./retrieval";
import { createTurnSession } from "./session";
import { gradeGoalReply } from "./goals";
import { getRuntimeHost } from "./host";
import { resolveChatModel } from "./models";
import { turnPiiMasking, withPiiMasking } from "./pii-masking";
import { admitAiSpend, CONVERSATION_SPEND_CAPACITY, spendConnectionKinds } from "./spend-admission";
import type { UsageEvent } from "./types";

/**
 * The `replay_improvement` job (docs/design/answer-improvement-workflow.md):
 * up to three synthetic questions against the Assistant's latest Publication
 * and live knowledge, each graded against explicit expected text and,
 * optionally, citations. It writes only the validation record: no
 * Conversation, no Inbox message, no Insights traffic, no status change.
 */

/** Actions that answer and do nothing else. A Publication with any other is refused. */
const ANSWER_ONLY_ACTIONS = new Set([
  "custom_message",
  "basic_reply",
  "search_knowledge",
  "follow_up_questions",
  "show_button",
  "iframe",
  // A proactive Flow's only action; a replayed message never fires it.
  "notification",
]);

/** The direct-storage twin of `replayCaseSchema` in @ciele/ops: the row is re-read, never trusted. */
const casesSchema = z
  .array(
    z
      .object({
        question: z.string().trim().min(1).max(2000),
        expectations: z
          .object({
            mustContain: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
            mustCiteSources: z.boolean().optional(),
          })
          .strict(),
      })
      .strict(),
  )
  .min(1)
  .max(3);

const JOB_TIME_LIMIT_MS = 60_000;
const CASE_TIME_LIMIT_MS = 20_000;
const ANSWER_MAX_CHARS = 10_000;

export const improvementReplayHandler: JobHandler = {
  async perform(job, { db }) {
    const id = job.payload.validationId;
    if (typeof id !== "string") throw new Error("Invalid replay job payload");
    const run = await db.table("improvementValidations").get(id);
    if (!run || run.organizationId !== job.organizationId || run.kind !== "replay" || run.status !== "pending") {
      return;
    }
    const results: ImprovementValidation["results"] = [];
    const settle = (patch: Pick<ImprovementValidation, "status" | "detail">) =>
      db.table("improvementValidations").update(run.id, {
        ...patch,
        results,
        completedAt: new Date().toISOString(),
      });
    try {
      const cases = casesSchema.parse(run.cases);
      // Refuse stale inputs before spending anything.
      if ((await db.getAssistantValidationSnapshot(run.assistantId)) !== run.snapshot) {
        throw new Error("Publication or knowledge changed before replay. Request a new replay.");
      }
      const publication = await db.getLatestPublication(run.assistantId);
      if (!publication || publication.id !== run.publicationId) {
        throw new Error("Published configuration changed before replay. Request a new replay.");
      }
      const config = publication.config;
      if (config.flows.some((flow) => flow.enabled && flow.actions.some((action) => !ANSWER_ONLY_ACTIONS.has(action)))) {
        throw new Error("Replay supports answer-only Assistants. This Publication has actions with external effects.");
      }
      const assistant = { ...config.assistant, createdAt: publication.createdAt, updatedAt: publication.createdAt };
      const connections = await db.listProviderConnections(run.organizationId);
      const resolved = resolveChatModel(assistant.modelProvider, assistant.modelId, connections);
      const platformPrompt = await getRuntimeHost().getPlatformSystemPrompt();
      const signal = AbortSignal.timeout(JOB_TIME_LIMIT_MS);
      for (const test of cases) {
        if (signal.aborted) throw new Error("Replay time limit reached");
        const admission = resolved
          ? await admitAiSpend({
              db,
              organizationId: run.organizationId,
              connectionKinds: spendConnectionKinds(resolved.credentialKind),
              capacity: CONVERSATION_SPEND_CAPACITY,
            })
          : null;
        const usage: UsageEvent[] = [];
        try {
          if (admission?.blocked) throw new Error(`Replay budget blocked: ${admission.blocked.detail}`);
          // The question is often a Visitor's own words: mask it under the
          // Publication's guardrail exactly as the widget turn would.
          const masking = turnPiiMasking(config.assistant.guardrails, [], test.question);
          const result = await withPiiMasking(masking?.masker ?? null, () =>
            runAssistantChat({
              assistant,
              platformPrompt,
              flows: config.flows,
              skills: config.skills ?? [],
              connections,
              message: test.question,
              history: [],
              session: createTurnSession(`replay-${run.id}`, {}),
              routing: { now: new Date() },
              searchKnowledge: buildKnowledgeSearcher({
                db,
                connections,
                assistant,
                collectionId: null,
                conversationId: null,
                usage: { surface: "scheduled" },
              }),
              signal: AbortSignal.any([signal, AbortSignal.timeout(CASE_TIME_LIMIT_MS)]),
              usageSink: usage,
              emit: () => {},
            }),
          );
          const verdict = gradeGoalReply(result.parts, test.expectations);
          results.push({
            question: test.question,
            answer: messageText(result.parts).slice(0, ANSWER_MAX_CHARS),
            ...verdict,
          });
        } catch (error) {
          // A failed case keeps the cases before it.
          results.push({ question: test.question, answer: "", pass: false, detail: thrownMessage(error, "Replay failed") });
        } finally {
          try {
            await admission?.settle(
              usage.map((event) => ({
                ...event,
                organizationId: run.organizationId,
                assistantId: run.assistantId,
                stage: "goal_eval" as const,
                surface: "scheduled" as const,
              })),
            );
          } finally {
            await admission?.release();
          }
        }
      }
      if ((await db.getAssistantValidationSnapshot(run.assistantId)) !== run.snapshot) {
        throw new Error("Publication or knowledge changed during replay. The results are stale.");
      }
      await settle({
        status: results.every((result) => result.pass) ? "pass" : "fail",
        detail:
          "Synthetic answers checked against explicit text and citation expectations. Check the customer widget before you resolve.",
      });
    } catch (error) {
      await settle({ status: "error", detail: thrownMessage(error, "Replay failed") });
    }
  },
  async onTerminalFailure(job, { db }, message) {
    if (typeof job.payload.validationId !== "string") return;
    const run = await db.table("improvementValidations").get(job.payload.validationId);
    if (run?.organizationId === job.organizationId && run.status === "pending") {
      await db
        .table("improvementValidations")
        .update(run.id, { status: "error", detail: message, completedAt: new Date().toISOString() });
    }
  },
};
