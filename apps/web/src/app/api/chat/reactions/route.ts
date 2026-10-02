import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getWidgetDb, resolveWidgetContext, subjectOwnsConversation, widgetSubject } from "@/lib/widget-db";
import { isReactionEmoji } from "@/lib/emoji-catalog";

async function resolve(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const messageId = query.get("messageId");
  if (!messageId || messageId.length > 200) return null;
  const assistantId = query.get("assistantId");
  const db = getWidgetDb();
  if (assistantId) {
    const ctx = await resolveWidgetContext(request, Promise.resolve({ assistantId }));
    if (ctx instanceof Response) return null;
    const organizationId = ctx.publication.config.assistant.organizationId;
    const subject = widgetSubject(request, organizationId, query.get("visitorId") ?? "");
    const conversation = await db.getConversationForMessage(messageId);
    const message = await db.getMessage(messageId);
    if (!subjectOwnsConversation(conversation, assistantId, subject) || message?.role !== "assistant") return null;
    return { db, organizationId, messageId, channelMessageId: null, actorId: `${subject.type}:${subject.id}`, actorName: subject.gate?.claim && ["name", "displayName", "display_name", "preferred_username", "email"].includes(subject.gate.claim.name) ? subject.gate.claim.value : "Visitor", cors: ctx.cors };
  }
  const session = await getSession();
  if (!session?.organization) return null;
  const organizationId = session.organization.id;
  const channelId = query.get("channelId");
  if (channelId) {
    const channel = await db.table("teammateChannels").get(channelId);
    const message = await db.getChannelMessage(messageId);
    if (!channel || channel.organizationId !== organizationId || message?.channelId !== channelId || message.organizationId !== organizationId || message.authorType === "system") return null;
    const roster = await db.table("teammateChannelParticipants").list({ channelId });
    if (!roster.some((seat) => seat.userId === session.userId)) return null;
  } else {
    const conversation = await db.getConversationForMessage(messageId);
    const message = await db.getMessage(messageId);
    if (!conversation || message?.role !== "assistant") return null;
    if (conversation.teammateId) {
      const teammate = await db.table("teammates").get(conversation.teammateId);
      if (teammate?.organizationId !== organizationId || conversation.subjectId !== session.userId) return null;
    } else {
      const assistant = conversation.assistantId ? await db.getAssistant(conversation.assistantId) : null;
      if (assistant?.organizationId !== organizationId) return null;
    }
  }
  const actorName = [session.profile?.firstName, session.profile?.lastName].filter(Boolean).join(" ") || session.profile?.username || session.email;
  return { db, organizationId, messageId, channelMessageId: channelId ? messageId : null, actorId: `member:${session.userId}`, actorName, cors: {} };
}

export async function GET(request: NextRequest) {
  const ctx = await resolve(request);
  if (!ctx) return Response.json({ error: "Message not found" }, { status: 404 });
  try {
    return Response.json({ reactions: await ctx.db.listMessageReactions(ctx.organizationId, ctx.messageId), actorId: ctx.actorId }, { headers: ctx.cors });
  } catch (error) {
    // Additive deployment: hide the feature until the schema applier creates it.
    if (error && typeof error === "object" && "code" in error && ["42P01", "PGRST205"].includes(String(error.code))) {
      return Response.json({ error: "Reactions not available yet" }, { status: 503, headers: ctx.cors });
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  const ctx = await resolve(request);
  if (!ctx) return Response.json({ error: "Message not found" }, { status: 404 });
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !("emoji" in body) || !("selected" in body) || !isReactionEmoji(body.emoji) || typeof body.selected !== "boolean") {
    return Response.json({ error: "Invalid reaction" }, { status: 400, headers: ctx.cors });
  }
  await ctx.db.setMessageReaction({ organizationId: ctx.organizationId, messageId: ctx.messageId, channelMessageId: ctx.channelMessageId, actorId: ctx.actorId, actorName: ctx.actorName, emoji: body.emoji }, body.selected);
  return Response.json({ reactions: await ctx.db.listMessageReactions(ctx.organizationId, ctx.messageId), actorId: ctx.actorId }, { headers: ctx.cors });
}
