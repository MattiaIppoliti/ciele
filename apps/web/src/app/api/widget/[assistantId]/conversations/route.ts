import { NextRequest } from "next/server";
import {
  resolveWidgetContext,
  visitorOwnsConversation,
  widgetOptions,
} from "@/lib/widget-db";

/** Visitor history: list conversations, or messages of one (?messages=<id>). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assistantId: string }> }
) {
  const ctx = await resolveWidgetContext(request, params);
  if (ctx instanceof Response) return ctx;
  const { db, assistantId, cors } = ctx;

  const visitorId = request.nextUrl.searchParams.get("visitorId") ?? "";
  if (!visitorId) return new Response("Bad request", { status: 400, headers: cors });

  const messagesOf = request.nextUrl.searchParams.get("messages");
  if (messagesOf) {
    const conversation = await db.getConversation(messagesOf);
    if (!visitorOwnsConversation(conversation, assistantId, visitorId)) {
      return new Response("Not found", { status: 404, headers: cors });
    }
    const messages = await db.listMessages(messagesOf);
    return Response.json({ messages }, { headers: cors });
  }

  const conversations = await db.listConversations(assistantId, "visitor", visitorId);
  return Response.json(
    {
      conversations: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
      })),
    },
    { headers: cors }
  );
}

export const OPTIONS = widgetOptions;
