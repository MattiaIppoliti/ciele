import { z } from "zod";
import type {
  Assistant,
  Flow,
  FlowAction,
  FlowActionSettings,
  FlowCondition,
  FlowConditionLogic,
  FlowInput,
  FlowPatch,
  FlowTrigger,
  FlowTriggerSettings,
} from "@agent-hub/core";
import {
  actionAllowedForTrigger,
  mergeFlowSecrets,
  redactFlowSecrets,
  redactFlowsSecrets,
} from "@agent-hub/core";
import type { OperationContext } from "./operation";
import { OperationError, defineOperation } from "./operation";

/**
 * The Flows domain (#621). Same shape as assistants.ts: scalars validated,
 * structured router config (trigger settings, conditions, action settings)
 * shape-trusted via z.custom, the Flow Builder authors it, and the
 * trigger/action pairing rule below is the invariant that must hold no
 * matter which surface stored the flow.
 */

const flowTriggerSchema = z.custom<FlowTrigger>((v) => typeof v === "string");
const flowActionsSchema = z.custom<FlowAction[]>(Array.isArray);

const flowConfigShape = {
  description: z.string().max(2000),
  trigger: flowTriggerSchema,
  triggerSettings: z.custom<FlowTriggerSettings>(
    (v) => typeof v === "object" && v !== null
  ),
  conditionLogic: z.custom<FlowConditionLogic>((v) => typeof v === "string"),
  conditions: z.custom<FlowCondition[]>(Array.isArray),
  actions: flowActionsSchema,
  actionSettings: z.custom<FlowActionSettings>(
    (v) => typeof v === "object" && v !== null
  ),
  customMessage: z.string().max(10000),
};

export const flowInputSchema = z.object({
  name: z.string().min(1).max(200),
  ...Object.fromEntries(
    Object.entries(flowConfigShape).map(([k, s]) => [k, s.optional()])
  ),
}) as z.ZodType<FlowInput, FlowInput>;

export const flowPatchSchema = z
  .object({ name: z.string().min(1).max(200), enabled: z.boolean(), ...flowConfigShape })
  .partial() satisfies z.ZodType<FlowPatch, FlowPatch>;

/**
 * The trigger/action pairing rule (#541), enforced where it can't be
 * bypassed: a stale client or a direct API call must not store a proactive
 * flow that runs generative actions, or a message flow that answers with an
 * unprompted notification.
 */
function assertTriggerActions(
  trigger: FlowTrigger,
  actions: FlowAction[] | undefined
) {
  const invalid = (actions ?? []).find(
    (action) => !actionAllowedForTrigger(action, trigger)
  );
  if (invalid) {
    throw new OperationError(
      "invalid_input",
      `The "${invalid}" action cannot run on the "${trigger}" trigger.`
    );
  }
}

async function requireAssistant(
  ctx: OperationContext,
  id: string
): Promise<Assistant> {
  const assistant = await ctx.db.getAssistant(id);
  if (!assistant || assistant.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Assistant not found");
  }
  return assistant;
}

/** Flow id → Flow whose Assistant belongs to the caller's org, or not_found. */
async function requireFlow(ctx: OperationContext, id: string): Promise<Flow> {
  const flow = await ctx.db.getFlow(id);
  if (!flow) throw new OperationError("not_found", "Flow not found");
  await requireAssistant(ctx, flow.assistantId);
  return flow;
}

export const listFlowsOp = defineOperation({
  name: "flows.list",
  capability: "member",
  input: z.object({ assistantId: z.string().min(1) }),
  entities: () => [],
  run: async (ctx, { assistantId }) => {
    await requireAssistant(ctx, assistantId);
    return redactFlowsSecrets(await ctx.db.listFlows(assistantId));
  },
});

export const getFlowOp = defineOperation({
  name: "flows.get",
  capability: "member",
  input: z.object({ id: z.string().min(1) }),
  entities: () => [],
  run: async (ctx, { id }) => redactFlowSecrets(await requireFlow(ctx, id)),
});

export const createFlowOp = defineOperation({
  name: "flows.create",
  capability: "edit",
  input: z.object({ assistantId: z.string().min(1), input: flowInputSchema }),
  entities: ({ assistantId }) => [{ kind: "flows" as const, assistantId }],
  run: async (ctx, { assistantId, input }) => {
    await requireAssistant(ctx, assistantId);
    assertTriggerActions(input.trigger ?? "message", input.actions);
    return redactFlowSecrets(await ctx.db.createFlow(assistantId, input));
  },
});

export const updateFlowOp = defineOperation({
  name: "flows.update",
  capability: "edit",
  input: z.object({ id: z.string().min(1), patch: flowPatchSchema }),
  entities: (_input, result: Flow) => [
    { kind: "flows" as const, assistantId: result.assistantId },
  ],
  run: async (ctx, { id, patch }) => {
    const stored = await requireFlow(ctx, id);
    // A patch may move the trigger, the actions, or only one of the two,
    // the rule applies to the pair that will be stored.
    if (patch.trigger !== undefined || patch.actions !== undefined) {
      assertTriggerActions(
        patch.trigger ?? stored.trigger ?? "message",
        patch.actions ?? stored.actions
      );
    }
    // `stored` came back redacted-free from the Db, but the *caller's* copy did
    // not: reads project the api_request credentials out, so an editor that
    // round-trips the settings blob sends them back blank. Restore them rather
    // than letting a save erase a credential the caller was never given.
    const merged =
      patch.actionSettings === undefined
        ? patch
        : {
            ...patch,
            actionSettings: mergeFlowSecrets(
              patch.actionSettings,
              stored.actionSettings
            ),
          };
    return redactFlowSecrets(await ctx.db.updateFlow(id, merged));
  },
});

export const deleteFlowOp = defineOperation({
  name: "flows.delete",
  capability: "edit",
  input: z.object({ id: z.string().min(1) }),
  entities: (_input, result: Flow) => [
    { kind: "flows" as const, assistantId: result.assistantId },
  ],
  run: async (ctx, { id }) => {
    const flow = await requireFlow(ctx, id);
    // Default behavior is the locked catch-all: the editor never offers
    // deleting it, so the API must refuse too, not rely on UI absence.
    if (flow.isDefault) {
      throw new OperationError("conflict", "Default behavior cannot be deleted");
    }
    await ctx.db.deleteFlow(id);
    return flow;
  },
});

export const reorderFlowsOp = defineOperation({
  name: "flows.reorder",
  capability: "edit",
  input: z.object({
    assistantId: z.string().min(1),
    orderedIds: z.array(z.string().min(1)).max(500),
  }),
  entities: ({ assistantId }) => [{ kind: "flows" as const, assistantId }],
  run: async (ctx, { assistantId, orderedIds }) => {
    await requireAssistant(ctx, assistantId);
    await ctx.db.reorderFlows(assistantId, orderedIds);
    // Redacted like every other read here: the ops layer is the seam that
    // decides this, so a caller never has to know which op it went through.
    return redactFlowsSecrets(await ctx.db.listFlows(assistantId));
  },
});
