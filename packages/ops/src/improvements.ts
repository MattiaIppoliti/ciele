import { z } from "zod";
import type { Improvement, ImprovementPatch } from "@agent-hub/core";
import type { OperationContext } from "./operation";
import { OperationError, defineOperation } from "./operation";

/**
 * The Improvements domain (#625): the answer-quality kanban, readable by any
 * member-tier key and editable at `edit`, so external trackers can sync.
 * Creation stays web-only for now (it fans out into graph feedback and
 * Suggested-Fix drafting); this ships list / detail / update.
 */

async function requireImprovement(
  ctx: OperationContext,
  id: string
): Promise<Improvement> {
  const improvement = await ctx.db.getImprovement(id);
  if (!improvement || improvement.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Improvement not found");
  }
  return improvement;
}

export const improvementPatchSchema = z
  .object({
    title: z.string().min(1).max(300),
    description: z.string().max(10000),
    status: z.custom<Improvement["status"]>((v) => typeof v === "string"),
    priority: z.custom<Improvement["priority"]>(
      (v) => typeof v === "string" || v === null
    ),
    tags: z.array(z.string().max(100)).max(50),
    assigneeId: z.string().nullable(),
    dueDate: z.string().nullable(),
  })
  .partial() satisfies z.ZodType<ImprovementPatch, ImprovementPatch>;

export const listImprovementsOp = defineOperation({
  name: "improvements.list",
  capability: "member",
  input: z.object({}),
  entities: () => [],
  run: (ctx) => ctx.db.listImprovements(ctx.organizationId),
});

export const getImprovementOp = defineOperation({
  name: "improvements.get",
  capability: "member",
  input: z.object({ id: z.string().min(1) }),
  entities: () => [],
  run: async (ctx, { id }) => {
    const improvement = await requireImprovement(ctx, id);
    const [associations, proposal] = await Promise.all([
      ctx.db.listImprovementMessages(id),
      ctx.db.getImprovementProposal(id),
    ]);
    return { improvement, associations, proposal };
  },
});

export const updateImprovementOp = defineOperation({
  name: "improvements.update",
  capability: "edit",
  input: z.object({ id: z.string().min(1), patch: improvementPatchSchema }),
  entities: ({ id }) => [
    { kind: "improvementList" as const },
    { kind: "improvement" as const, id },
  ],
  run: async (ctx, { id, patch }) => {
    const before = await requireImprovement(ctx, id);
    const updated = await ctx.db.updateImprovement(id, patch);
    await ctx.ports?.notifyImprovementUpdate?.({ before, updated, patch });
    return updated;
  },
});
