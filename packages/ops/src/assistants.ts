import { z } from "zod";
import type {
  Assistant,
  AssistantPatch,
  FlowPatch,
  HelpDeskSettings,
  KnowledgeEngine,
  Provider,
  QuickReplyButton,
} from "@agent-hub/core";
import { sortFlows } from "@agent-hub/core";
import { OperationError, defineOperation } from "./operation";

/**
 * The Assistants domain (#620) — the first extraction from the web app's
 * server actions, and the pattern every later domain follows: the action and
 * the /api/v1 route both call these, so behavior can't drift between the two
 * surfaces.
 */

/**
 * Scalars are validated for real; structured config fields (quick replies,
 * style, help-desk settings, tools) are shape-trusted via z.custom — they are
 * editor-authored configuration whose deep validation lives with the editors
 * that build them, and tightening one later is additive here.
 */
export const assistantPatchSchema = z
  .object({
    title: z.string().min(1).max(200),
    nickname: z.string().max(200),
    description: z.string().max(500),
    avatarUrl: z.string(),
    welcomeMessage: z.string().max(10000),
    aiDisclaimer: z.string().max(1000),
    suggestedQuestions: z.array(z.string().max(500)).max(50),
    quickReplies: z.custom<QuickReplyButton[]>(Array.isArray),
    answeringStyle: z.string().max(10000),
    simplifiedThinking: z.boolean(),
    chatLauncherEnabled: z.boolean(),
    modelProvider: z.custom<Provider>((v) => typeof v === "string"),
    modelId: z.string().max(200),
    style: z.custom<Assistant["style"]>(
      (v) => typeof v === "object" && v !== null
    ),
    allowedDomains: z.array(z.string().max(253)).max(100),
    helpDeskSettings: z.custom<HelpDeskSettings>(
      (v) => typeof v === "object" && v !== null
    ),
    tools: z.custom<Assistant["tools"]>(
      (v) => typeof v === "object" && v !== null
    ),
    requireSignIn: z.boolean(),
    knowledgeEngine: z.custom<KnowledgeEngine>((v) => typeof v === "string"),
  })
  .partial() satisfies z.ZodType<AssistantPatch, AssistantPatch>;

const idSchema = z.object({ id: z.string().min(1) });

/** Shared guard: id → Assistant in the caller's Organization, or not_found. */
async function requireAssistant(
  ctx: { organizationId: string; db: { getAssistant(id: string): Promise<Assistant | null> } },
  id: string
): Promise<Assistant> {
  const assistant = await ctx.db.getAssistant(id);
  if (!assistant || assistant.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Assistant not found");
  }
  return assistant;
}

export const listAssistantsOp = defineOperation({
  name: "assistants.list",
  capability: "member",
  input: z.object({}),
  entities: () => [],
  run: (ctx) => ctx.db.listAssistants(ctx.organizationId),
});

export const getAssistantOp = defineOperation({
  name: "assistants.get",
  capability: "member",
  input: idSchema,
  entities: () => [],
  run: (ctx, { id }) => requireAssistant(ctx, id),
});

export const createAssistantOp = defineOperation({
  name: "assistants.create",
  capability: "edit",
  input: z.object({
    title: z.string().min(1).max(200),
    nickname: z.string().max(200).optional(),
    description: z.string().max(500).optional(),
  }),
  entities: () => [{ kind: "assistantList" as const }],
  run: (ctx, input) => ctx.db.createAssistant(ctx.organizationId, input),
});

export const updateAssistantOp = defineOperation({
  name: "assistants.update",
  capability: "edit",
  input: z.object({ id: z.string().min(1), patch: assistantPatchSchema }),
  entities: ({ id }) => [{ kind: "assistant" as const, id }],
  run: async (ctx, { id, patch }) => {
    await requireAssistant(ctx, id);
    return ctx.db.updateAssistant(id, patch);
  },
});

export const deleteAssistantOp = defineOperation({
  name: "assistants.delete",
  capability: "publish",
  input: idSchema,
  entities: () => [{ kind: "assistantList" as const }],
  run: async (ctx, { id }) => {
    await requireAssistant(ctx, id);
    // Deleting an Assistant cascade-deletes its Collections and Concepts,
    // which would orphan each Collection's derived graph dataset (ADR-0017).
    // Capture the Collections first and purge whole datasets through the
    // host port — one purge per Collection, never a per-Concept fan-out.
    const collections = await ctx.db.listCollections(id);
    await ctx.db.deleteAssistant(id);
    for (const collection of collections) {
      await ctx.ports?.purgeCollectionGraph?.(collection.id);
    }
  },
});

/**
 * "Duplicate assistant": copies configuration (general settings, style,
 * help-desk settings, attached Skills) and all Flows. Knowledge,
 * Publications and Conversations stay with the original.
 */
export const duplicateAssistantOp = defineOperation({
  name: "assistants.duplicate",
  capability: "edit",
  input: idSchema,
  entities: () => [{ kind: "assistantList" as const }],
  run: async (ctx, { id }): Promise<Assistant> => {
    const source = await requireAssistant(ctx, id);

    const copy = await ctx.db.createAssistant(ctx.organizationId, {
      title: `${source.title} (copy)`,
      nickname: source.nickname,
      description: source.description,
    });
    await ctx.db.updateAssistant(copy.id, {
      avatarUrl: source.avatarUrl,
      welcomeMessage: source.welcomeMessage,
      aiDisclaimer: source.aiDisclaimer,
      suggestedQuestions: source.suggestedQuestions,
      quickReplies: source.quickReplies,
      answeringStyle: source.answeringStyle,
      chatLauncherEnabled: source.chatLauncherEnabled,
      modelProvider: source.modelProvider,
      modelId: source.modelId,
      style: source.style,
      allowedDomains: source.allowedDomains,
      helpDeskSettings: source.helpDeskSettings,
      tools: source.tools,
    });
    // Skills are org-level, so the copy can share the source's attachments.
    const attachedSkills = await ctx.db.listAssistantSkills(source.id);
    if (attachedSkills.length > 0) {
      await ctx.db.setAssistantSkills(
        copy.id,
        attachedSkills.map((s) => s.id)
      );
    }

    // createAssistant seeds the built-in flow set; overwrite the seeds with
    // the source's versions (matched by name) and recreate any custom flows.
    const [sourceFlows, copyFlows] = await Promise.all([
      ctx.db.listFlows(source.id).then(sortFlows),
      ctx.db.listFlows(copy.id).then(sortFlows),
    ]);
    const consumed = new Set<string>();
    const orderedCopyIds: string[] = [];
    for (const flow of sourceFlows) {
      const patch: FlowPatch = {
        name: flow.name,
        description: flow.description,
        enabled: flow.enabled,
        trigger: flow.trigger,
        triggerSettings: flow.triggerSettings,
        conditionLogic: flow.conditionLogic,
        conditions: flow.conditions,
        actions: flow.actions,
        actionSettings: flow.actionSettings,
        customMessage: flow.customMessage,
      };
      const seed = copyFlows.find(
        (f) =>
          !consumed.has(f.id) &&
          f.name === flow.name &&
          f.builtIn === flow.builtIn &&
          f.isDefault === flow.isDefault
      );
      if (seed) {
        consumed.add(seed.id);
        await ctx.db.updateFlow(seed.id, patch);
        if (!flow.isDefault) orderedCopyIds.push(seed.id);
      } else {
        const created = await ctx.db.createFlow(copy.id, {
          name: flow.name,
          description: flow.description,
          trigger: flow.trigger,
          triggerSettings: flow.triggerSettings,
          conditionLogic: flow.conditionLogic,
          conditions: flow.conditions,
          actions: flow.actions,
          actionSettings: flow.actionSettings,
          customMessage: flow.customMessage,
        });
        if (!flow.enabled) await ctx.db.updateFlow(created.id, { enabled: false });
        orderedCopyIds.push(created.id);
      }
    }
    // Seeded flows the source no longer has (e.g. a deleted built-in).
    for (const leftover of copyFlows) {
      if (!consumed.has(leftover.id) && !leftover.isDefault) {
        await ctx.db.deleteFlow(leftover.id);
      }
    }
    await ctx.db.reorderFlows(copy.id, orderedCopyIds);

    // The `copy` in hand predates the config patch — return the stored row.
    return (await ctx.db.getAssistant(copy.id)) ?? copy;
  },
});
