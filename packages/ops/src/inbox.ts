import { z } from "zod";
import type { Conversation } from "@agent-hub/core";
import type { OperationContext } from "./operation";
import { OperationError, defineOperation } from "./operation";

/**
 * The Inbox domain (#624 and CLI parity): any member-capability key
 * (including viewer tier) may review and curate Conversations.
 * Export row *building* stays at the surface (it is a projection with a
 * role-gated reasoning flag); these operations own the guarded reads.
 */

async function requireConversation(
  ctx: OperationContext,
  id: string
): Promise<Conversation> {
  const conversation = await ctx.db.getConversation(id);
  if (!conversation) throw new OperationError("not_found", "Conversation not found");
  const assistant = await ctx.db.getAssistant(conversation.assistantId);
  if (!assistant || assistant.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Conversation not found");
  }
  return conversation;
}

export const listInboxConversationsOp = defineOperation({
  name: "inbox.conversations.list",
  capability: "member",
  input: z.object({}),
  entities: () => [],
  run: (ctx) => ctx.db.listInboxConversations(ctx.organizationId),
});

export const getConversationOp = defineOperation({
  name: "inbox.conversations.get",
  capability: "member",
  input: z.object({ id: z.string().min(1) }),
  entities: () => [],
  run: async (ctx, { id }) => {
    const conversation = await requireConversation(ctx, id);
    const messages = await ctx.db.listMessages(id);
    return { conversation, messages };
  },
});

/**
 * Guarded transcript reads for the export endpoint: same batch bound as the
 * web export so one call can't turn into 500 concurrent reads. Row shaping
 * (the 29-field record, reasoning gate applied) happens at the surface.
 */
export const readConversationsForExportOp = defineOperation({
  name: "inbox.conversations.export-read",
  capability: "member",
  input: z.object({
    conversationIds: z.array(z.string().min(1)).min(1).max(500),
  }),
  entities: () => [],
  run: async (ctx, { conversationIds }) => {
    const wanted = new Set(conversationIds);
    const conversations = (
      await ctx.db.listInboxConversations(ctx.organizationId)
    ).filter((c) => wanted.has(c.id));
    const BATCH = 20;
    const out: Array<{
      conversation: (typeof conversations)[number];
      messages: Awaited<ReturnType<typeof ctx.db.listMessages>>;
    }> = [];
    for (let i = 0; i < conversations.length; i += BATCH) {
      const batch = conversations.slice(i, i + BATCH);
      out.push(
        ...(await Promise.all(
          batch.map(async (conversation) => ({
            conversation,
            messages: await ctx.db.listMessages(conversation.id),
          }))
        ))
      );
    }
    return out;
  },
});

export const setConversationPinnedOp = defineOperation({
  name: "inbox.conversations.pin",
  capability: "member",
  input: z.object({ id: z.string().min(1), pinned: z.boolean() }),
  entities: () => [{ kind: "inbox" as const }],
  run: async (ctx, { id, pinned }) => {
    await requireConversation(ctx, id);
    await ctx.db.setConversationPinned(id, pinned);
    return requireConversation(ctx, id);
  },
});

export const sendConversationFeedbackOp = defineOperation({
  name: "inbox.conversations.feedback",
  capability: "member",
  input: z.object({ id: z.string().min(1), text: z.string().trim().min(1).max(2_000) }),
  entities: () => [{ kind: "inbox" as const }],
  run: async (ctx, { id, text }) => {
    await requireConversation(ctx, id);
    await ctx.db.updateConversationMetadata(id, {
      feedbackText: text,
      feedbackAt: new Date().toISOString(),
    });
    return requireConversation(ctx, id);
  },
});

export const deleteConversationOp = defineOperation({
  name: "inbox.conversations.delete",
  capability: "member",
  input: z.object({ id: z.string().min(1) }),
  entities: () => [{ kind: "inbox" as const }],
  run: async (ctx, { id }) => {
    await requireConversation(ctx, id);
    await ctx.db.deleteConversation(id);
  },
});

export const setMessageFeedbackOp = defineOperation({
  name: "inbox.messages.feedback",
  capability: "member",
  input: z.object({
    messageId: z.string().min(1),
    feedback: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  }),
  entities: () => [{ kind: "inbox" as const }],
  run: async (ctx, { messageId, feedback }) => {
    const conversation = await ctx.db.getConversationForMessage(messageId);
    if (!conversation) throw new OperationError("not_found", "Message not found");
    const assistant = await ctx.db.getAssistant(conversation.assistantId);
    if (!assistant || assistant.organizationId !== ctx.organizationId) {
      throw new OperationError("not_found", "Message not found");
    }
    await ctx.db.setMessageFeedback(messageId, feedback);
    return { messageId, feedback };
  },
});
