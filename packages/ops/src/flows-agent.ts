import { z } from "zod";
import type { Assistant, Conversation, Teammate } from "@agent-hub/core";
import { thrownMessage } from "@agent-hub/core";
import type { OperationContext } from "./operation";
import { OperationError, defineOperation } from "./operation";

/**
 * The Flows Agent (spec #836, #838): a system Teammate, one per Assistant,
 * that builds and edits Flows with the Editor from the Flow Canvas.
 *
 * It is an ordinary Teammate in every way the runtime cares about, persona
 * layer, conversations, grants, provider routing, so nothing here is a second
 * chat. What is its own: it is created by the product on first use rather than
 * by a Member, it carries `systemKind` + `assistantId` so the roster and the
 * referral picker leave it out, and its one grant is the `flows` domain, whose
 * tools hand changes back to the canvas instead of writing rows.
 */

export const FLOWS_AGENT_NAME = "Flows Agent";

/** The persona layer: what the agent is for and how it must behave. */
const FLOWS_AGENT_ROLE = [
  "You build and edit Flows for one Assistant in Ciele, working beside the Editor in the Flow Canvas.",
  "A Flow is trigger → conditions → an ordered list of response actions. You change the open Flow only through the flows_draft tool, which hands the change to the Editor's unsaved draft; you never save, the Editor does. When you change the actions but keep the trigger, pass the open flow's trigger as currentTrigger so the pairing rule checks the right one.",
  "When the request describes a second intent that belongs in its own Flow, use flows_propose to hand a complete Flow back as a proposal instead of drafting it into the open one.",
  "Read the standing context first: the current draft, the Assistant's other Flows, its Help Desks, FAQs and connections. Never duplicate an intent another Flow already routes.",
  "When you add a Connector action that writes to an external system, put a human_review action before it; the safe shape is the default and removing the gate is the Editor's call.",
  "After a tool call, tell the Editor in one or two sentences what you changed and why. Keep messages verbatim when the Editor gives exact wording.",
].join(" ");

async function requireAssistant(ctx: OperationContext, id: string): Promise<Assistant> {
  const assistant = await ctx.db.getAssistant(id);
  if (!assistant || assistant.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Assistant not found");
  }
  return assistant;
}

async function findFlowsAgent(
  ctx: OperationContext,
  assistantId: string
): Promise<Teammate | null> {
  const rows = await ctx.db.table("teammates").list({
    organizationId: ctx.organizationId,
    systemKind: "flows_agent",
    assistantId,
    deletedAt: null,
  });
  return rows[0] ?? null;
}

/**
 * The Assistant's Flows Agent, created on first use. Idempotent: a second call
 * returns the same row.
 *
 * The `flows` grant is written **once, at creation**, through the host's
 * `grantSystemTeammate` port (the grant table's RLS is admin-only, the canvas
 * is an Editor's surface). It is deliberately not re-asserted afterwards: a
 * grant an admin revoked stays revoked (#770 makes granting an admin decision),
 * and the agent then talks without acting, which the panel shows honestly.
 *
 * Two Editors opening the same new canvas at once both miss the lookup; the
 * partial unique index lets one insert win, and the loser re-reads instead of
 * failing the turn.
 */
export const ensureFlowsAgentOp = defineOperation({
  name: "flows.agent.ensure",
  capability: "edit",
  input: z.object({ assistantId: z.string().min(1) }),
  // The row it may create is a Teammate; a repeat call revalidates a roster
  // that did not change, which is cheap and never wrong.
  entities: () => [{ kind: "teammateList" as const }],
  run: async (ctx, { assistantId }) => {
    const assistant = await requireAssistant(ctx, assistantId);
    const existing = await findFlowsAgent(ctx, assistantId);
    if (existing) return existing;
    let teammate: Teammate;
    try {
      teammate = await ctx.db.table("teammates").insert({
        organizationId: ctx.organizationId,
        ownerId: ctx.userId,
        name: FLOWS_AGENT_NAME,
        title: `Builds ${assistant.title}'s flows`,
        roleDescription: FLOWS_AGENT_ROLE,
        visibility: "org",
        systemKind: "flows_agent",
        assistantId,
      });
    } catch (error) {
      const raced = await findFlowsAgent(ctx, assistantId);
      if (raced) return raced;
      throw new OperationError(
        "conflict",
        thrownMessage(error, "Could not create the Flows Agent")
      );
    }
    const grant = {
      organizationId: ctx.organizationId,
      teammateId: teammate.id,
      domain: "flows" as const,
      grantedBy: ctx.userId || null,
    };
    try {
      if (ctx.ports?.grantSystemTeammate) await ctx.ports.grantSystemTeammate(grant);
      else await ctx.db.table("teammateGrants").insert(grant);
    } catch (error) {
      // Two writes, no transaction. A grant that failed would leave an agent
      // the next call finds and returns as-is, permanently unable to act,
      // because a missing grant is also what an admin's revocation looks like
      // and the lookup cannot tell the two apart. So the half-made agent is
      // removed and the Editor's next message creates it whole.
      await ctx.db.table("teammates").delete(teammate.id).catch(() => undefined);
      throw new OperationError("conflict", thrownMessage(error, "Could not grant the Flows Agent"));
    }
    return teammate;
  },
});

/**
 * Attach the new-Flow canvas's conversations to the Flow it became (#838).
 * A conversation held while the Flow was still unsaved carries `flowId: null`;
 * once Save creates the Flow, the thread would otherwise vanish from that
 * Flow's panel and sit forever under a canvas that no longer exists. Adopts
 * this Member's null-tagged conversations for the Assistant, which is the set
 * the new-Flow canvas showed them.
 */
export const adoptFlowsAgentThreadOp = defineOperation({
  name: "flows.agent.adopt",
  capability: "edit",
  input: z.object({
    assistantId: z.string().min(1),
    flowId: z.string().min(1),
  }),
  entities: () => [],
  run: async (ctx, { assistantId, flowId }): Promise<{ adopted: number }> => {
    await requireAssistant(ctx, assistantId);
    const flow = await ctx.db.getFlow(flowId);
    if (!flow || flow.assistantId !== assistantId) {
      throw new OperationError("not_found", "Flow not found");
    }
    const teammate = await findFlowsAgent(ctx, assistantId);
    if (!teammate) return { adopted: 0 };
    const conversations = await ctx.db.listTeammateConversations(teammate.id, ctx.userId);
    let adopted = 0;
    for (const conversation of conversations) {
      const tag = conversation.metadata.flowsAgent;
      if (!tag || tag.assistantId !== assistantId || tag.flowId !== null) continue;
      await ctx.db.updateConversationMetadata(conversation.id, {
        ...conversation.metadata,
        flowsAgent: { assistantId, flowId },
      });
      adopted += 1;
    }
    return { adopted };
  },
});

/**
 * This Member's conversations with the Assistant's Flows Agent about one Flow
 * (`flowId` null = the new-Flow canvas). The Teammate's thread already scopes
 * to one Member; the Flow tag on the conversation narrows it to one canvas.
 */
export const listFlowsAgentThreadOp = defineOperation({
  name: "flows.agent.thread",
  capability: "member",
  input: z.object({
    assistantId: z.string().min(1),
    flowId: z.string().min(1).nullable(),
  }),
  entities: () => [],
  run: async (ctx, { assistantId, flowId }): Promise<Conversation[]> => {
    await requireAssistant(ctx, assistantId);
    const teammate = await findFlowsAgent(ctx, assistantId);
    if (!teammate) return [];
    const conversations = await ctx.db.listTeammateConversations(teammate.id, ctx.userId);
    return conversations.filter(
      (conversation) => (conversation.metadata.flowsAgent?.flowId ?? null) === flowId
    );
  },
});

/** One past Flows Agent conversation, reopened in the panel. */
export const readFlowsAgentConversationOp = defineOperation({
  name: "flows.agent.conversation",
  capability: "member",
  input: z.object({
    assistantId: z.string().min(1),
    conversationId: z.string().min(1),
  }),
  entities: () => [],
  run: async (ctx, { assistantId, conversationId }) => {
    await requireAssistant(ctx, assistantId);
    const teammate = await findFlowsAgent(ctx, assistantId);
    const conversation = await ctx.db.getConversation(conversationId);
    if (
      !teammate ||
      !conversation ||
      conversation.teammateId !== teammate.id ||
      conversation.subjectId !== ctx.userId
    ) {
      throw new OperationError("not_found", "Conversation not found");
    }
    return { conversation, messages: await ctx.db.listMessages(conversationId) };
  },
});
