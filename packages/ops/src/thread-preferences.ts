import { z } from "zod";
import { defineOperation, OperationError, type OperationContext } from "./operation";
import { requireReadableTeammate } from "./teammate-access";
import { deleteConversationOp, requireConversation } from "./inbox";
import { deleteChannelOp, requireChannel } from "./channels";
import type { ThreadTarget } from "@agent-hub/core";

const targetSchema = z.object({ kind: z.enum(["inbox", "conversation", "channel"]), id: z.string().min(1) });
async function requireTarget(ctx: OperationContext, target: ThreadTarget) {
  if (target.kind === "channel") {
    await requireChannel(ctx, target.id);
  } else if (target.kind === "inbox") {
    await requireConversation(ctx, target.id);
  } else {
    const conversation = await ctx.db.getConversation(target.id);
    if (!conversation?.teammateId || conversation.subjectId !== ctx.userId || conversation.subjectType !== "member") {
      throw new OperationError("not_found", "Conversation not found");
    }
    await requireReadableTeammate(ctx, conversation.teammateId);
  }
}
export const listThreadPreferencesOp = defineOperation({
  name: "threads.preferences.list", capability: "member", effect: "read",
  input: z.object({}), entities: () => [],
  run: async ctx => {
    const rows: import("@agent-hub/core").ThreadPreference[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await ctx.db.table("threadPreferences").list({ organizationId: ctx.organizationId, userId: ctx.userId }, { limit: 500, offset });
      rows.push(...page);
      if (page.length < 500) return rows;
    }
  },
});
export const setThreadPreferenceOp = defineOperation({
  name: "threads.preferences.set", capability: "member", effect: "write",
  input: z.object({ target: targetSchema, action: z.enum(["archive", "flag"]), enabled: z.boolean() }),
  entities: () => [],
  run: async (ctx, { target, action, enabled }) => {
    await requireTarget(ctx, target);
    const filter = {
      organizationId: ctx.organizationId, userId: ctx.userId, action,
      conversationId: target.kind === "channel" ? null : target.id,
      channelId: target.kind === "channel" ? target.id : null,
    };
    const table = ctx.db.table("threadPreferences");
    const existing = await table.list(filter);
    if (!enabled) {
      for (const row of existing) await table.delete(row.id);
    } else if (!existing.length) {
      try { await table.insert(filter); }
      catch (error) {
        // An overlapping enable can win the unique insert; any other failure stays visible.
        if (!(await table.list(filter)).length) throw error;
      }
    }
    return enabled ? (await table.list(filter))[0] ?? null : null;
  },
});
export const deleteThreadOp = defineOperation({
  name: "threads.delete", capability: "member", effect: "consequential", input: targetSchema,
  entities: target => target.kind === "inbox" ? [{ kind: "inbox" }] : [{ kind: "teammateList" }, { kind: "channelList" }],
  run: async (ctx, target) => {
    await requireTarget(ctx, target);
    if (target.kind === "channel") await deleteChannelOp.run(ctx, { id: target.id });
    else if (target.kind === "inbox") await deleteConversationOp.run(ctx, { id: target.id });
    else await ctx.db.deleteConversation(target.id);

  },
});
