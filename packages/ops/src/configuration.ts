import type {
  Alert,
  Assistant,
  AssistantGoal,
  GoalExpectations,
  Skill,
  SkillInput,
  SkillPatch,
} from "@agent-hub/core";
import { z } from "zod";
import { OperationError, defineOperation, type OperationContext } from "./operation";

const idSchema = z.string().min(1);

async function requireAssistant(ctx: OperationContext, id: string): Promise<Assistant> {
  const assistant = await ctx.db.getAssistant(id);
  if (!assistant || assistant.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Assistant not found");
  }
  return assistant;
}

async function requireSkill(ctx: OperationContext, id: string): Promise<Skill> {
  const skill = (await ctx.db.listSkills(ctx.organizationId)).find((item) => item.id === id);
  if (!skill) throw new OperationError("not_found", "Skill not found");
  return skill;
}

async function requireGoal(
  ctx: OperationContext,
  assistantId: string,
  goalId: string
): Promise<AssistantGoal> {
  await requireAssistant(ctx, assistantId);
  const goal = (await ctx.db.listAssistantGoals(assistantId)).find(
    (item) => item.id === goalId
  );
  if (!goal) throw new OperationError("not_found", "Goal not found");
  return goal;
}

function sanitizeExpectations(input: GoalExpectations): GoalExpectations {
  const expectations: GoalExpectations = {};
  if (input.mustCiteSources) expectations.mustCiteSources = true;
  const expectedSourceUrl = input.expectedSourceUrl?.trim();
  if (expectedSourceUrl) expectations.expectedSourceUrl = expectedSourceUrl;
  const mustContain = (input.mustContain ?? []).map((item) => item.trim()).filter(Boolean);
  if (mustContain.length) expectations.mustContain = mustContain;
  return expectations;
}

export const skillInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional(),
  prompt: z.string().trim().min(1).max(50_000),
}) satisfies z.ZodType<SkillInput>;

export const skillPatchSchema = skillInputSchema.partial() satisfies z.ZodType<SkillPatch>;

export const goalExpectationsSchema = z.object({
  mustCiteSources: z.boolean().optional(),
  expectedSourceUrl: z.string().max(2_000).optional(),
  mustContain: z.array(z.string().max(1_000)).max(100).optional(),
}) satisfies z.ZodType<GoalExpectations>;

export const listSkillsOp = defineOperation({
  name: "skills.list",
  capability: "member",
  input: z.object({}),
  entities: () => [],
  run: (ctx) => ctx.db.listSkills(ctx.organizationId),
});

export const createSkillOp = defineOperation({
  name: "skills.create",
  capability: "edit",
  input: skillInputSchema.extend({ attachToAssistantId: idSchema.optional() }),
  entities: ({ attachToAssistantId }) =>
    attachToAssistantId
      ? [{ kind: "assistantEditor" as const, assistantId: attachToAssistantId }]
      : [{ kind: "assistantList" as const }],
  run: async (ctx, { attachToAssistantId, ...input }) => {
    if (attachToAssistantId) await requireAssistant(ctx, attachToAssistantId);
    const skill = await ctx.db.createSkill(ctx.organizationId, input);
    if (attachToAssistantId) {
      const attached = await ctx.db.listAssistantSkills(attachToAssistantId);
      await ctx.db.setAssistantSkills(attachToAssistantId, [
        ...attached.map((item) => item.id),
        skill.id,
      ]);
    }
    return skill;
  },
});

export const updateSkillOp = defineOperation({
  name: "skills.update",
  capability: "edit",
  input: z.object({ id: idSchema, patch: skillPatchSchema }),
  entities: () => [{ kind: "assistantList" as const }],
  run: async (ctx, { id, patch }) => {
    await requireSkill(ctx, id);
    return ctx.db.updateSkill(id, patch);
  },
});

export const deleteSkillOp = defineOperation({
  name: "skills.delete",
  capability: "edit",
  input: z.object({ id: idSchema }),
  entities: () => [{ kind: "assistantList" as const }],
  run: async (ctx, { id }) => {
    await requireSkill(ctx, id);
    await ctx.db.deleteSkill(id);
  },
});

export const getAssistantSkillsOp = defineOperation({
  name: "assistants.skills.get",
  capability: "member",
  input: z.object({ assistantId: idSchema }),
  entities: () => [],
  run: async (ctx, { assistantId }) => {
    await requireAssistant(ctx, assistantId);
    return ctx.db.listAssistantSkills(assistantId);
  },
});

export const setAssistantSkillsOp = defineOperation({
  name: "assistants.skills.set",
  capability: "edit",
  input: z.object({
    assistantId: idSchema,
    skillIds: z.array(idSchema).max(100).refine(
      (ids) => new Set(ids).size === ids.length,
      "Skill ids must be unique"
    ),
  }),
  entities: ({ assistantId }) => [
    { kind: "assistantEditor" as const, assistantId },
  ],
  run: async (ctx, { assistantId, skillIds }) => {
    await requireAssistant(ctx, assistantId);
    const available = new Set(
      (await ctx.db.listSkills(ctx.organizationId)).map((skill) => skill.id)
    );
    if (skillIds.some((id) => !available.has(id))) {
      throw new OperationError("invalid_input", "Every Skill must belong to this Organization");
    }
    await ctx.db.setAssistantSkills(assistantId, skillIds);
    return ctx.db.listAssistantSkills(assistantId);
  },
});

export const listAssistantGoalsOp = defineOperation({
  name: "goals.list",
  capability: "member",
  input: z.object({ assistantId: idSchema }),
  entities: () => [],
  run: async (ctx, { assistantId }) => {
    await requireAssistant(ctx, assistantId);
    return ctx.db.listAssistantGoals(assistantId);
  },
});

export const createAssistantGoalOp = defineOperation({
  name: "goals.create",
  capability: "edit",
  input: z.object({
    assistantId: idSchema,
    question: z.string().trim().min(1).max(10_000),
    expectations: goalExpectationsSchema,
  }),
  entities: ({ assistantId }) => [{ kind: "assistantEditor" as const, assistantId }],
  run: async (ctx, { assistantId, question, expectations }) => {
    await requireAssistant(ctx, assistantId);
    return ctx.db.createAssistantGoal(assistantId, {
      question,
      expectations: sanitizeExpectations(expectations),
    });
  },
});

export const updateAssistantGoalOp = defineOperation({
  name: "goals.update",
  capability: "edit",
  input: z.object({
    assistantId: idSchema,
    goalId: idSchema,
    patch: z.object({
      question: z.string().trim().min(1).max(10_000).optional(),
      expectations: goalExpectationsSchema.optional(),
      status: z.enum(["active", "quarantined"]).optional(),
    }),
  }),
  entities: ({ assistantId }) => [{ kind: "assistantEditor" as const, assistantId }],
  run: async (ctx, { assistantId, goalId, patch }) => {
    await requireGoal(ctx, assistantId, goalId);
    return ctx.db.updateAssistantGoal(goalId, {
      ...patch,
      expectations: patch.expectations
        ? sanitizeExpectations(patch.expectations)
        : undefined,
    });
  },
});

export const deleteAssistantGoalOp = defineOperation({
  name: "goals.delete",
  capability: "edit",
  input: z.object({ assistantId: idSchema, goalId: idSchema }),
  entities: ({ assistantId }) => [{ kind: "assistantEditor" as const, assistantId }],
  run: async (ctx, { assistantId, goalId }) => {
    await requireGoal(ctx, assistantId, goalId);
    await ctx.db.deleteAssistantGoal(goalId);
  },
});

export const listAlertsOp = defineOperation({
  name: "alerts.list",
  capability: "member",
  input: z.object({}),
  entities: () => [],
  run: (ctx) => ctx.db.listAlerts(ctx.organizationId),
});

export const resolveAlertOp = defineOperation({
  name: "alerts.resolve",
  capability: "edit",
  input: z.object({ id: idSchema }),
  entities: () => [{ kind: "alerts" as const }],
  run: async (ctx, { id }): Promise<Alert> => {
    const alert = (await ctx.db.listAlerts(ctx.organizationId)).find((item) => item.id === id);
    if (!alert) throw new OperationError("not_found", "Alert not found");
    return ctx.db.resolveAlert(id, ctx.userId || null);
  },
});
