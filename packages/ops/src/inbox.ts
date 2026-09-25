import { z } from "zod";
import type {
  Conversation,
  InboxConversation,
  InboxConversationReview,
  InboxQuery,
  ReviewRequest,
  StoredMessage,
} from "@agent-hub/core";
import { feedbackReactionScore } from "@agent-hub/core";
import type { OperationContext } from "./operation";
import { OperationError, defineOperation } from "./operation";

const inboxQuerySchema = z.object({
  cursor: z.string().nullable().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  search: z.string().optional(),
  userInfo: z.string().optional(),
  location: z.string().optional(),
  city: z.string().optional(),
  role: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  assistantId: z.string().min(1).optional(),
  language: z.string().optional(),
  workflow: z.string().optional(),
  conversationIds: z.array(z.string().min(1)).max(500).optional(),
  feedback: z.enum(["", "up", "down", "neutral"]).optional(),
  escalation: z.enum(["", "escalated", "not_escalated"]).optional(),
  staff: z.enum(["", "include", "only"]).optional(),
});

const INBOX_READ_PAGE_SIZE = 100;
export const INBOX_SUMMARY_WINDOW_LIMIT = 10_000;
const INBOX_TRANSCRIPT_BATCH_SIZE = 20;

/**
 * The Inbox read model (#624): one query contract and one guarded traversal
 * serve the console, API, export, and Teammate surfaces. Presentation-specific
 * row shaping stays with the caller.
 */

async function requireConversation(
  ctx: OperationContext,
  id: string
): Promise<Conversation> {
  const conversation = await ctx.db.getConversation(id);
  if (!conversation) throw new OperationError("not_found", "Conversation not found");
  // The Inbox is the customer queue: a Teammate Conversation has no Assistant
  // and is not reachable here at all (#768), it is read from the Teammate's
  // own thread by the Member who had it.
  const assistant = conversation.assistantId
    ? await ctx.db.getAssistant(conversation.assistantId)
    : null;
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
  run: async (ctx) =>
    (await ctx.db.getInboxPage(ctx.organizationId, {})).conversations,
});

/** Bounded keyset page for every interactive surface. */
export const listInboxPageOp = defineOperation({
  name: "inbox.conversations.page",
  capability: "member",
  input: inboxQuerySchema,
  entities: () => [],
  run: (ctx, query) => ctx.db.getInboxPage(ctx.organizationId, query),
});

export const getInboxFacetsOp = defineOperation({
  name: "inbox.facets.get",
  capability: "member",
  input: z.object({}),
  entities: () => [],
  run: (ctx) => ctx.db.getInboxFacets(ctx.organizationId),
});

/** How many review requests one Conversation's detail pane will ever show. */
const INBOX_CONVERSATION_REVIEW_LIMIT = 50;

/**
 * What the Inbox's detail pane loads for one Conversation.
 *
 * `InboxConversationReview` is the Db read; the review requests are composed on
 * top of it here rather than widened into it, because no `Db` method returns
 * them together. Named so the web action can state the same shape instead of
 * spelling the intersection out a second time.
 */
export type InboxConversationDetail = InboxConversationReview & {
  reviews: ReviewRequest[];
};

export const getInboxConversationReviewOp = defineOperation({
  name: "inbox.conversations.review",
  capability: "member",
  input: z.object({ conversationId: z.string().min(1) }),
  entities: () => [],
  run: async (
    ctx,
    { conversationId }
  ): Promise<InboxConversationDetail> => {
    await requireConversation(ctx, conversationId);
    // The Human review requests ride the same hydration as the transcript, and
    // deliberately not a second call from the client: a list fetched on its own
    // schedule is a list that can still be showing the Conversation before this
    // one, which is exactly how the card shipped.
    const [review, reviews] = await Promise.all([
      ctx.db.getInboxConversationReview(conversationId),
      ctx.db
        .table("reviewRequests")
        .list(
          { organizationId: ctx.organizationId, conversationId },
          { limit: INBOX_CONVERSATION_REVIEW_LIMIT }
        ),
    ]);
    return { ...review, reviews };
  },
});

async function readInboxWindow(options: {
  ctx: OperationContext;
  query: InboxQuery;
  limit: number;
}): Promise<{ conversations: InboxConversation[]; truncated: boolean }> {
  const { ctx, query, limit } = options;
  const conversations: InboxConversation[] = [];
  let cursor: string | null = query.cursor ?? null;
  let more = false;
  do {
    const remaining = limit - conversations.length;
    const page = await ctx.db.getInboxPage(ctx.organizationId, {
      ...query,
      cursor,
      limit: Math.min(INBOX_READ_PAGE_SIZE, remaining),
    });
    conversations.push(...page.conversations);
    cursor = page.nextCursor;
    more = cursor !== null;
  } while (more && conversations.length < limit);
  return { conversations, truncated: more };
}

export const readInboxSummaryWindowOp = defineOperation({
  name: "inbox.conversations.summary-window",
  capability: "member",
  input: z.object({
    query: inboxQuerySchema.omit({ cursor: true, limit: true }),
    limit: z.number().int().min(1).max(INBOX_SUMMARY_WINDOW_LIMIT),
  }),
  entities: () => [],
  run: (ctx, { query, limit }) => readInboxWindow({ ctx, query, limit }),
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
    query: inboxQuerySchema.omit({ cursor: true, limit: true }),
    limit: z.number().int().min(1).max(500),
  }),
  entities: () => [],
  run: async (ctx, { query, limit }) => {
    const window = await readInboxWindow({ ctx, query, limit });
    const rows: Array<{
      conversation: InboxConversation;
      messages: StoredMessage[];
    }> = [];
    for (
      let i = 0;
      i < window.conversations.length;
      i += INBOX_TRANSCRIPT_BATCH_SIZE
    ) {
      const batch = window.conversations.slice(
        i,
        i + INBOX_TRANSCRIPT_BATCH_SIZE,
      );
      rows.push(
        ...(await Promise.all(
          batch.map(async (conversation) => ({
            conversation,
            messages: await ctx.db.listMessages(conversation.id),
          }))
        ))
      );
    }
    return { rows, truncated: window.truncated };
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

/**
 * Legal hold (#801, CYB-12). An administrative act, not a member one: it
 * suspends a deletion the organization has committed to, and the person doing
 * it has to be someone who can answer for that.
 */
export const setConversationLegalHoldOp = defineOperation({
  name: "inbox.conversations.legalHold",
  capability: "manageMembers",
  input: z.object({ id: z.string().min(1), legalHold: z.boolean() }),
  entities: () => [{ kind: "inbox" as const }],
  run: async (ctx, { id, legalHold }) => {
    await requireConversation(ctx, id);
    await ctx.db.setConversationLegalHold(id, legalHold);
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
    // The one exit of a webhook gate nobody configured (#842): the row
    // cascades with the Conversation, so the unsubscribe has to go first.
    await ctx.ports?.unsubscribeWebhooks?.(id);
    await ctx.db.deleteConversation(id);
  },
});

export const setMessageFeedbackOp = defineOperation({
  name: "inbox.messages.feedback",
  capability: "member",
  input: z.object({
    messageId: z.string().min(1),
    feedback: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    reaction: z.enum(["positive", "neutral", "negative"]).nullable().optional(),
  }),
  entities: () => [{ kind: "inbox" as const }],
  run: async (ctx, { messageId, feedback, reaction }) => {
    if (reaction && feedbackReactionScore(reaction) !== feedback) {
      throw new OperationError("invalid_input", "Reaction and feedback score do not match");
    }
    const conversation = await ctx.db.getConversationForMessage(messageId);
    if (!conversation) throw new OperationError("not_found", "Message not found");
    // No Assistant means a Teammate Conversation, which the Inbox does not
    // hold (#768); the read below then refuses it like any foreign row.
    const assistant = conversation.assistantId
      ? await ctx.db.getAssistant(conversation.assistantId)
      : null;
    if (!assistant || assistant.organizationId !== ctx.organizationId) {
      throw new OperationError("not_found", "Message not found");
    }
    await ctx.db.setMessageFeedback(messageId, feedback, reaction ?? null);
    return { messageId, feedback, reaction: reaction ?? null };
  },
});
