import { NextRequest } from "next/server";
import {
  resolveWidgetContext,
  visitorOwnsConversation,
  widgetOptions,
} from "@/lib/widget-db";

/**
 * Conversation-level "Send feedback" from the widget's ⋯ menu — the public
 * counterpart of the admin preview's sendConversationFeedbackAction, writing
 * the same metadata fields so the Inbox shows both identically. Ownership is
 * the widget surface's standard rule: the visitor may only leave feedback on
 * a conversation they started with this assistant.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assistantId: string }> }
) {
  const ctx = await resolveWidgetContext(request, params);
  if (ctx instanceof Response) return ctx;
  const { db, assistantId, cors } = ctx;

  const body = (await request.json()) as {
    conversationId?: string;
    visitorId?: string;
    text?: string;
  };
  const text = body.text?.trim();
  if (!body.conversationId || !body.visitorId || !text) {
    return new Response("Bad request", { status: 400, headers: cors });
  }

  const conversation = await db.getConversation(body.conversationId);
  if (!visitorOwnsConversation(conversation, assistantId, body.visitorId)) {
    return new Response("Not found", { status: 404, headers: cors });
  }

  await db.updateConversationMetadata(conversation.id, {
    feedbackText: text.slice(0, 2000),
    feedbackAt: new Date().toISOString(),
  });
  return Response.json({ ok: true }, { headers: cors });
}

export const OPTIONS = widgetOptions;
