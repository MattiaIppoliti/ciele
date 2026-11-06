import { isImprovementWorkflowUnavailable } from "@agent-hub/db";
import type { ImprovementValidation } from "@agent-hub/core";
import { z } from "zod";
import { defineOperation, OperationError, type OperationContext } from "./operation";

/**
 * Validation evidence for an Improvement (docs/design/answer-improvement-
 * workflow.md): a Member's own check of the customer widget, or one bounded
 * synthetic replay. Neither moves the Improvement's status. An agent may read
 * the evidence but never write it: the two writes are in no Teammate's curated
 * catalogue and are excluded by name from Ciele AI's (`platform-actions.ts`),
 * because a machine must not assert a human check or spend on a replay.
 */

const targetSchema = z.object({ improvementId: z.string().min(1), assistantId: z.string().min(1) });
const evidenceSchema = targetSchema.extend({
  expectedBehavior: z.string().trim().min(1).max(5000),
  changedResources: z.string().trim().min(1).max(5000),
});

/** A replay case: one question and the text its answer must contain. */
export const replayCaseSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  expectations: z
    .object({
      mustContain: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
      mustCiteSources: z.boolean().optional(),
    })
    .strict(),
});
export const REPLAY_MAX_CASES = 3;

async function requireImprovement(ctx: OperationContext, improvementId: string) {
  const improvement = await ctx.db.getImprovement(improvementId);
  if (!improvement || improvement.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Improvement not found");
  }
  return improvement;
}

async function requireTarget(ctx: OperationContext, input: z.infer<typeof targetSchema>) {
  await requireImprovement(ctx, input.improvementId);
  const assistant = await ctx.db.getAssistant(input.assistantId);
  if (!assistant || assistant.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Assistant not found");
  }
  return assistant;
}

/** Only a signed-in Member, never a key or a Teammate, may sign a check or spend on a replay. */
function requireMemberActor(ctx: OperationContext, what: string): string {
  if (ctx.teammate || ctx.apiKeyId || !ctx.userId) {
    throw new OperationError("invalid_input", `A Member must ${what}`);
  }
  return ctx.userId;
}

export interface ImprovementValidationView {
  /** False while the migration that adds the table has not landed. */
  available: boolean;
  records: Array<ImprovementValidation & { stale: boolean }>;
}

export const listImprovementValidationsOp = defineOperation({
  name: "improvements.validations.list",
  capability: "improvements:view",
  effect: "read",
  input: z.object({ improvementId: z.string().min(1) }),
  entities: () => [],
  run: async (ctx, { improvementId }): Promise<ImprovementValidationView> => {
    await requireImprovement(ctx, improvementId);
    try {
      const records = await ctx.db
        .table("improvementValidations")
        .list({ organizationId: ctx.organizationId, improvementId }, { limit: 50 });
      // A record is stale once its Assistant's Publication or knowledge moved.
      const snapshots = new Map<string, string>();
      for (const record of records) {
        if (!snapshots.has(record.assistantId)) {
          snapshots.set(record.assistantId, await ctx.db.getAssistantValidationSnapshot(record.assistantId));
        }
      }
      return {
        available: true,
        records: records.map((record) => ({
          ...record,
          stale: record.snapshot !== snapshots.get(record.assistantId),
        })),
      };
    } catch (error) {
      if (isImprovementWorkflowUnavailable(error)) return { available: false, records: [] };
      throw error;
    }
  },
});

export const recordImprovementValidationOp = defineOperation({
  name: "improvements.validations.record",
  capability: "improvements:edit",
  effect: "write",
  input: evidenceSchema.extend({
    detail: z.string().trim().min(1).max(5000),
    result: z.enum(["pass", "fail"]),
  }),
  entities: ({ improvementId }) => [{ kind: "improvement" as const, id: improvementId }],
  run: async (ctx, input): Promise<ImprovementValidation> => {
    const validatorId = requireMemberActor(ctx, "record a customer widget check");
    await requireTarget(ctx, input);
    const publication = await ctx.db.getLatestPublication(input.assistantId);
    const { result, ...evidence } = input;
    return ctx.db.createImprovementValidation(ctx.organizationId, {
      ...evidence,
      validatorId,
      kind: "manual",
      status: result,
      publicationId: publication?.id ?? null,
      snapshot: await ctx.db.getAssistantValidationSnapshot(input.assistantId),
      cases: [],
      results: [],
      completedAt: new Date().toISOString(),
    });
  },
});

export const requestImprovementReplayOp = defineOperation({
  name: "improvements.replay",
  capability: "improvements:edit",
  // Spends model credit on the Organization's account.
  effect: "consequential",
  input: evidenceSchema.extend({
    cases: z.array(replayCaseSchema).min(1).max(REPLAY_MAX_CASES),
  }),
  entities: ({ improvementId }) => [{ kind: "improvement" as const, id: improvementId }],
  run: async (ctx, input): Promise<ImprovementValidation> => {
    const validatorId = requireMemberActor(ctx, "request a replay");
    await requireTarget(ctx, input);
    if (!ctx.ports?.enqueueImprovementReplay) {
      throw new OperationError("invalid_input", "The replay worker is unavailable");
    }
    const publication = await ctx.db.getLatestPublication(input.assistantId);
    if (!publication) {
      throw new OperationError("invalid_input", "Publish the Assistant before you replay its answers");
    }
    const pending = await ctx.db
      .table("improvementValidations")
      .list(
        { organizationId: ctx.organizationId, improvementId: input.improvementId, kind: "replay", status: "pending" },
        { limit: 1 },
      );
    if (pending.length > 0) {
      throw new OperationError("conflict", "A replay is already pending for this Improvement");
    }
    // The insert queues the job in the same transaction; the port only
    // starts it sooner than the cron drain would.
    const run = await ctx.db.createImprovementValidation(ctx.organizationId, {
      ...input,
      validatorId,
      kind: "replay",
      status: "pending",
      publicationId: publication.id,
      snapshot: await ctx.db.getAssistantValidationSnapshot(input.assistantId),
      detail: "Queued",
      results: [],
      completedAt: null,
    });
    await ctx.ports.enqueueImprovementReplay(run.id);
    return run;
  },
});
