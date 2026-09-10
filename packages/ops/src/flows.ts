import { z } from "zod";
import type { Assistant, Flow, FlowAction, FlowTrigger } from "@agent-hub/core";
import {
  actionAllowedForTrigger,
  mergeFlowSecrets,
  redactFlowSecrets,
  redactFlowsSecrets,
  withReviewBeforeConnectorWrites,
} from "@agent-hub/core";
import { flowInputSchema, flowPatchSchema, flowTriggerSchema } from "./flow-schema";
import type { OperationContext } from "./operation";
import { OperationError, defineOperation } from "./operation";

export { flowInputSchema, flowPatchSchema, flowTriggerSchema } from "./flow-schema";

/**
 * The Flows domain (#621). The router configuration (trigger settings,
 * conditions, action settings) is validated structurally by `flow-schema.ts`
 * (#837), and the trigger/action pairing rule below is the invariant that must
 * hold no matter which surface stored the flow.
 */

/**
 * The trigger/action pairing rule (#541), enforced where it can't be
 * bypassed: a stale client or a direct API call must not store a proactive
 * flow that runs generative actions, or a message flow that answers with an
 * unprompted notification.
 */
export function assertTriggerActions(
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

/**
 * The Flows Agent's two tools (#838). Neither writes a row.
 *
 * `flows.draft` validates a change to the **open** Flow and hands it back: the
 * canvas applies it to the Editor's unsaved draft, where it enters the Undo
 * history like a manual edit, and Save stays the Editor's act. `flows.propose`
 * validates a whole new Flow and hands it back as a proposal card; the Editor
 * creates it with one click, or does not. Both run the same structural schema
 * and the same trigger/action pairing rule the save path enforces, so what the
 * agent drafts is always something the runtime could run.
 */
export const draftFlowOp = defineOperation({
  name: "flows.draft",
  capability: "edit",
  input: z.object({
    /** One sentence for the transcript: what changed and why. */
    summary: z.string().min(1).max(500),
    /**
     * The open flow's trigger when the patch keeps it. The op never sees the
     * draft, so the pairing rule needs the model to say which trigger the
     * actions will run on; the canvas re-checks on apply regardless.
     */
    currentTrigger: flowTriggerSchema.optional(),
    patch: flowPatchSchema,
  }),
  entities: () => [],
  run: async (_ctx, { summary, currentTrigger, patch: raw }) => {
    // Enabling is the Editor's switch on the list, never part of a draft.
    const { enabled: _enabled, ...patch } = raw;
    if (patch.trigger !== undefined || patch.actions !== undefined) {
      assertTriggerActions(patch.trigger ?? currentTrigger ?? "message", patch.actions);
    }
    // Human review before a Connector write (#841) is a rule the draft passes
    // through, not a sentence the model may forget. Applied only when the
    // patch carries the actions: a patch to settings alone leaves order alone.
    // An inbound Flow cannot hold the gate, so the rule steps aside there.
    const trigger = patch.trigger ?? currentTrigger ?? "message";
    const gated =
      patch.actions && trigger !== "http_request"
        ? { ...patch, actions: withReviewBeforeConnectorWrites(patch.actions, patch.actionSettings) }
        : patch;
    return { applied: "draft" as const, summary, patch: gated };
  },
});

export const proposeFlowOp = defineOperation({
  name: "flows.propose",
  capability: "edit",
  input: z.object({
    assistantId: z.string().min(1),
    /** Why this belongs in its own Flow rather than the open one. */
    rationale: z.string().min(1).max(1000),
    flow: flowInputSchema,
  }),
  entities: () => [],
  run: async (ctx, { assistantId, rationale, flow }) => {
    await requireAssistant(ctx, assistantId);
    assertTriggerActions(flow.trigger ?? "message", flow.actions);
    const proposal =
      flow.actions && (flow.trigger ?? "message") !== "http_request"
        ? { ...flow, actions: withReviewBeforeConnectorWrites(flow.actions, flow.actionSettings) }
        : flow;
    return { proposal, rationale, assistantId };
  },
});

/**
 * The latest inbound runs of one HTTP-triggered Flow (#843): what an operator
 * reads from the trigger's own panel to see whether the endpoint is being
 * called, what it answered, and which action failed. Not the Inbox, by
 * decision: a run is not a Conversation.
 */
export const listHttpFlowRunsOp = defineOperation({
  name: "flows.http.runs",
  capability: "member",
  input: z.object({
    flowId: z.string().min(1),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  entities: () => [],
  run: async (ctx, { flowId, limit }) => {
    const flow = await ctx.db.getFlow(flowId);
    if (!flow) throw new OperationError("not_found", "Flow not found");
    await requireAssistant(ctx, flow.assistantId);
    return ctx.db.table("httpFlowRuns").list({ flowId }, { limit });
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
