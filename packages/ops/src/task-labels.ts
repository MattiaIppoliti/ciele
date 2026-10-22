import { z } from "zod";
import type { TaskLabel } from "@agent-hub/core";
import { WORK_COLORS } from "@agent-hub/core";
import { OperationError, defineOperation, type OperationContext } from "./operation";
import { workId as id } from "./work-schemas";

/**
 * Labels (#1049): an Organization's, not a Project's, so one "Bug" filters
 * every view. Managed by Editors (#1047), so the list is the Organization's own
 * rather than a fixed set.
 */

const name = z.string().trim().min(1).max(60);

async function requireLabel(ctx: OperationContext, labelId: string): Promise<TaskLabel> {
  const label = await ctx.db.table("taskLabels").get(labelId);
  if (!label || label.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Label not found");
  }
  return label;
}

async function assertNameFree(ctx: OperationContext, value: string, exceptId?: string): Promise<void> {
  const labels = await ctx.db.table("taskLabels").list({ organizationId: ctx.organizationId });
  if (labels.some((label) => label.id !== exceptId && label.name.toLowerCase() === value.toLowerCase())) {
    throw new OperationError("conflict", `A label called ${value} already exists.`);
  }
}

const labelEntities = () => [
  { kind: "taskLabels" as const },
  { kind: "taskList" as const },
  { kind: "projectList" as const },
];

export const listTaskLabelsOp = defineOperation({
  name: "taskLabels.list",
  capability: "member",
  effect: "read",
  input: z.object({}),
  entities: () => [],
  run: (ctx): Promise<TaskLabel[]> =>
    ctx.db.table("taskLabels").list({ organizationId: ctx.organizationId }, { orderBy: "name", ascending: true }),
});

export const createTaskLabelOp = defineOperation({
  name: "taskLabels.create",
  capability: "edit",
  effect: "write",
  input: z.object({ name, color: z.enum(WORK_COLORS).default("gray") }),
  entities: labelEntities,
  run: async (ctx, input): Promise<TaskLabel> => {
    await assertNameFree(ctx, input.name);
    return ctx.db.table("taskLabels").insert({
      organizationId: ctx.organizationId,
      name: input.name,
      color: input.color,
    });
  },
});

/** The PATCH body on /api/v1 (#1051): a new name, a new colour, or both. */
export const taskLabelPatchSchema = z.object({ name, color: z.enum(WORK_COLORS) }).partial();

export const updateTaskLabelOp = defineOperation({
  name: "taskLabels.update",
  capability: "edit",
  effect: "write",
  input: z.object({ id, patch: taskLabelPatchSchema }),
  entities: labelEntities,
  run: async (ctx, input): Promise<TaskLabel> => {
    await requireLabel(ctx, input.id);
    if (input.patch.name) await assertNameFree(ctx, input.patch.name, input.id);
    return ctx.db.table("taskLabels").update(input.id, input.patch);
  },
});

export const deleteTaskLabelOp = defineOperation({
  name: "taskLabels.delete",
  capability: "edit",
  effect: "consequential",
  input: z.object({ id }),
  entities: labelEntities,
  run: async (ctx, input): Promise<void> => {
    await requireLabel(ctx, input.id);
    // Every Task loses it (the links cascade); the Tasks themselves stay.
    await ctx.db.table("taskLabels").delete(input.id);
  },
});
