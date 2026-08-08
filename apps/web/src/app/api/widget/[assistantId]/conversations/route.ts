import { NextRequest } from "next/server";
import {
  resolveWidgetContext,
  subjectOwnsConversation,
  widgetOptions,
  widgetSubject,
} from "@/lib/widget-db";

/**
 * Subject history: list conversations, or messages of one (?messages=<id>).
 * An SSO-signed end-user reads the history of their verified subject (#662);
 * an anonymous visitor reads their client-generated id's history, as before.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assistantId: string }> }
) {
  const ctx = await resolveWidgetContext(request, params);
  if (ctx instanceof Response) return ctx;
  const { db, assistantId, publication, cors } = ctx;

  const visitorId = request.nextUrl.searchParams.get("visitorId") ?? "";
  const subject = widgetSubject(
    request,
    publication.config.assistant.organizationId,
    visitorId
  );
  if (!subject.id) {
    return new Response("Bad request", { status: 400, headers: cors });
  }

  const messagesOf = request.nextUrl.searchParams.get("messages");
  if (messagesOf) {
    const conversation = await db.getConversation(messagesOf);
    if (!subjectOwnsConversation(conversation, assistantId, subject)) {
      return new Response("Not found", { status: 404, headers: cors });
    }
    const messages = await db.listMessages(messagesOf);
    return Response.json({ messages }, { headers: cors });
  }

  const conversations = await db.listConversations(
    assistantId,
    subject.type,
    subject.id
  );
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
