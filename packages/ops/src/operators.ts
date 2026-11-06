import { z } from "zod";
import type { Conversation, StoredMessage } from "@agent-hub/core";
import { roleAllowsCapability, waitingQueue } from "@agent-hub/core";
import type { OperationContext } from "./operation";
import { OperationError, defineOperation } from "./operation";
import { requireConversation } from "./inbox";
import { assignWaitingConversations } from "./operator-staffing";

/**
 * A Member answering a Visitor from the Inbox (#1082).
 *
 * Take over, reply and release are their own capability, `operate`, a named
 * check rather than a rung on the Role ladder: the Support Agent Role (#1086)
 * may do this and nothing else an Editor may. None of the three is in a
 * Teammate's curated catalogue, a Visitor is answered by a person here.
 */

/** The name the Visitor sees beside an operator's reply. */
function operatorName(ctx: OperationContext): string {
  const name = ctx.actorName?.trim();
  if (name) return name;
  const email = ctx.actorEmail?.trim();
  if (email) return email.split("@")[0]!;
  return "Support";
}

function requireUser(ctx: OperationContext): string {
  if (!ctx.userId) {
    throw new OperationError("invalid_input", "Taking over a conversation needs a signed-in Member");
  }
  return ctx.userId;
}

export interface TakeOverResult {
  conversation: Conversation;
  /** The "joined the conversation" line, shown to the Visitor and in the Inbox. */
  line: StoredMessage;
}

export const takeOverConversationOp = defineOperation({
  name: "inbox.conversations.takeover",
  capability: "inbox:operate",
  assistant: async (ctx, input) => { const ref = input as { id?: string; conversationId?: string }; const id = ref.conversationId ?? ref.id; return id ? (await ctx.db.getConversation(id))?.assistantId ?? null : null; },
  effect: "write",
  input: z.object({ id: z.string().min(1) }),
  entities: () => [{ kind: "inbox" as const }],
  run: async (ctx, { id }): Promise<TakeOverResult> => {
    const userId = requireUser(ctx);
    const existing = await requireConversation(ctx, id);
    const name = operatorName(ctx);
    const conversation = await ctx.db.takeOverConversation({
      conversationId: id,
      memberId: userId,
      memberName: name,
      now: new Date().toISOString(),
    });
    if (!conversation) {
      const holder = (await ctx.db.getConversation(id))?.operator ?? existing.operator;
      throw new OperationError(
        "conflict",
        holder?.memberId === userId
          ? "You already hold this conversation"
          : `${holder?.memberName ?? "Another Member"} is already answering this conversation`
      );
    }
    const line = await ctx.db.appendOperatorMessage({
      conversationId: id,
      role: "system",
      text: `${name} joined the conversation`,
      authorMemberId: userId,
      authorName: name,
    });
    return { conversation, line };
  },
});

export const replyToConversationOp = defineOperation({
  name: "inbox.conversations.reply",
  capability: "inbox:operate",
  assistant: async (ctx, input) => { const ref = input as { id?: string; conversationId?: string }; const id = ref.conversationId ?? ref.id; return id ? (await ctx.db.getConversation(id))?.assistantId ?? null : null; },
  // It reaches a Visitor, which is what consequential means.
  effect: "consequential",
  input: z.object({
    id: z.string().min(1),
    text: z.string().trim().min(1).max(4_000),
  }),
  entities: () => [{ kind: "inbox" as const }],
  run: async (ctx, { id, text }): Promise<StoredMessage> => {
    const userId = requireUser(ctx);
    const conversation = await requireConversation(ctx, id);
    const operator = conversation.operator;
    if (operator?.state !== "held" || operator.memberId !== userId) {
      throw new OperationError(
        "conflict",
        operator?.state === "held"
          ? `${operator.memberName ?? "Another Member"} is answering this conversation`
          : "Take the conversation over before replying"
      );
    }
    return ctx.db.appendOperatorMessage({
      conversationId: id,
      role: "operator",
      text,
      authorMemberId: userId,
      authorName: operator.memberName ?? operatorName(ctx),
    });
  },
});

export interface ConversationLive {
  operator: Conversation["operator"] | null;
  /** Messages at or after `after`, oldest first; the caller de-duplicates by id. */
  messages: StoredMessage[];
}

/**
 * What the Inbox polls while a Conversation is held or waiting: who answers
 * it, and what arrived since the last look. Any Member may read it, like the
 * rest of the Inbox.
 */
export const readConversationLiveOp = defineOperation({
  name: "inbox.conversations.live",
  capability: "inbox:view",
  assistant: async (ctx, input) => { const ref = input as { id?: string; conversationId?: string }; const id = ref.conversationId ?? ref.id; return id ? (await ctx.db.getConversation(id))?.assistantId ?? null : null; },
  effect: "read",
  input: z.object({ id: z.string().min(1), after: z.string().datetime({ offset: true }) }),
  entities: () => [],
  run: async (ctx, { id, after }): Promise<ConversationLive> => {
    const conversation = await requireConversation(ctx, id);
    return {
      operator: conversation.operator ?? null,
      messages: await ctx.db.listMessagesSince(id, after),
    };
  },
});

/** One row of the Inbox Waiting view (#1083). */
export interface WaitingConversation {
  conversationId: string;
  title: string;
  subjectId: string;
  helpDeskId: string | null;
  helpDeskName: string | null;
  waitingSince: string;
  waitedMs: number;
  expiresAt: string;
  /** The operator it was assigned to (#1084), or null while unassigned. */
  assignedMemberId: string | null;
}

/**
 * The Waiting view: Visitors who asked for a person through a Live operator
 * channel and are still waiting, oldest first. A wait that ran out is gone
 * from it, the Conversation is the AI's again. Its length is the sidebar
 * badge, so one read answers both.
 */
export const listWaitingConversationsOp = defineOperation({
  name: "inbox.conversations.waiting",
  capability: "inbox:view",
  effect: "read",
  input: z.object({}),
  entities: () => [],
  run: async (ctx): Promise<WaitingConversation[]> => {
    const [conversations, desks] = await Promise.all([
      ctx.db.listOperatorConversations(ctx.organizationId),
      ctx.db.listHelpDesks(ctx.organizationId),
    ]);
    const deskNames = new Map(desks.map((desk) => [desk.id, desk.name]));
    return waitingQueue(conversations, new Date()).map((entry) => ({
      conversationId: entry.conversation.id,
      title: entry.conversation.title,
      subjectId: entry.conversation.subjectId,
      helpDeskId: entry.conversation.operator?.waitingHelpDeskId ?? null,
      helpDeskName: deskNames.get(entry.conversation.operator?.waitingHelpDeskId ?? "") ?? null,
      waitingSince: entry.waitingSince,
      waitedMs: entry.waitedMs,
      expiresAt: entry.expiresAt,
      assignedMemberId: entry.conversation.operator?.assignedMemberId ?? null,
    }));
  },
});

export const releaseConversationOp = defineOperation({
  name: "inbox.conversations.release",
  capability: "inbox:operate",
  assistant: async (ctx, input) => { const ref = input as { id?: string; conversationId?: string }; const id = ref.conversationId ?? ref.id; return id ? (await ctx.db.getConversation(id))?.assistantId ?? null : null; },
  effect: "write",
  input: z.object({ id: z.string().min(1) }),
  entities: () => [{ kind: "inbox" as const }],
  run: async (ctx, { id }): Promise<TakeOverResult> => {
    const userId = requireUser(ctx);
    const existing = await requireConversation(ctx, id);
    // The holder releases their own; an admin may hand back one a colleague
    // left held, so a Conversation is never stuck without the AI.
    const asAdmin = roleAllowsCapability(ctx.role, "manageMembers");
    const conversation = await ctx.db.releaseConversation({
      conversationId: id,
      memberId: asAdmin ? null : userId,
    });
    if (!conversation) {
      throw new OperationError(
        "conflict",
        existing.operator?.state === "held"
          ? "Only the Member answering this conversation can hand it back"
          : "Nobody is answering this conversation"
      );
    }
    // The operator freed a slot: a waiting Visitor may now be assigned (#1084).
    await assignWaitingConversations(ctx.db, ctx.organizationId).catch(() => []);
    // The line names whoever held it; its author is whoever released it,
    // which is a different Member when an admin hands a colleague's back.
    const holder = existing.operator?.memberName ?? operatorName(ctx);
    const line = await ctx.db.appendOperatorMessage({
      conversationId: id,
      role: "system",
      text: `${holder} left the conversation. The assistant will answer from here.`,
      authorMemberId: userId,
      authorName: operatorName(ctx),
    });
    return { conversation, line };
  },
});
