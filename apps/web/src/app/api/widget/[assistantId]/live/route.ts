import { NextRequest } from "next/server";
import {
  resolveWidgetContext,
  subjectOwnsConversation,
  widgetOptions,
  widgetSubject,
} from "@/lib/widget-db";
import { widgetLiveState, widgetMessage } from "@/lib/widget-live";

/**
 * The Widget's poll while a person answers its Conversation, or is awaited
 * (#1082, #1083): who answers, and the messages written since `after`. A
 * plain GET rather than a stream, so an idle Widget holds nothing open and
 * the cadence is the client's (`nextLivePollDelay`).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assistantId: string }> }
) {
  const ctx = await resolveWidgetContext(request, params);
  if (ctx instanceof Response) return ctx;
  const { db, assistantId, publication, cors } = ctx;

  const search = request.nextUrl.searchParams;
  const subject = widgetSubject(
    request,
    publication.config.assistant.organizationId,
    search.get("visitorId") ?? ""
  );
  const conversationId = search.get("conversationId") ?? "";
  const after = search.get("after") ?? "";
  if (!subject.id || !conversationId || Number.isNaN(Date.parse(after))) {
    return new Response("Bad request", { status: 400, headers: cors });
  }

  const conversation = await db.getConversation(conversationId);
  if (!subjectOwnsConversation(conversation, assistantId, subject)) {
    return new Response("Not found", { status: 404, headers: cors });
  }
  const messages = await db.listMessagesSince(conversationId, new Date(after).toISOString());
  return Response.json(
    {
      live: widgetLiveState(conversation, new Date()),
      messages: messages.map(widgetMessage),
    },
    { headers: { ...cors, "Cache-Control": "no-store" } }
  );
}

export const OPTIONS = widgetOptions;
