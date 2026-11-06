import { NextRequest } from "next/server";
import {
  feedbackReactionScore,
  isFeedbackReactionId,
} from "@agent-hub/core";
import {
  resolveWidgetContext,
  subjectOwnsConversation,
  widgetOptions,
  widgetSubject,
} from "@/lib/widget-db";

/**
 * A Visitor's rating of one answer. Ownership is the widget surface's standard
 * rule (#1137): the message must sit in a Conversation this subject started
 * with this Assistant. Before that rule a message id alone was enough, from any
 * page, for any Organization's message.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assistantId: string }> }
) {
  const ctx = await resolveWidgetContext(request, params);
  if (ctx instanceof Response) return ctx;
  const { db, assistantId, publication, cors } = ctx;

  const body = (await request.json()) as {
    messageId: string;
    visitorId?: string;
    feedback?: -1 | 0 | 1;
    reaction?: unknown;
  };
  const hasReaction = Object.hasOwn(body, "reaction");
  const reaction = isFeedbackReactionId(body.reaction) ? body.reaction : null;
  const subject = widgetSubject(
    request,
    publication.config.assistant.organizationId,
    body.visitorId ?? ""
  );
  if (
    !body.messageId ||
    !subject.id ||
    (hasReaction && body.reaction !== null && !isFeedbackReactionId(body.reaction)) ||
    (!hasReaction && ![-1, 0, 1].includes(body.feedback ?? 99))
  ) {
    return new Response("Bad request", { status: 400, headers: cors });
  }

  const conversation = await db.getConversationForMessage(body.messageId);
  if (!subjectOwnsConversation(conversation, assistantId, subject)) {
    return new Response("Not found", { status: 404, headers: cors });
  }

  const feedback = hasReaction
    ? feedbackReactionScore(reaction)
    : body.feedback!;
  await db.setMessageFeedback(body.messageId, feedback, hasReaction ? reaction : null);
  return Response.json({ ok: true }, { headers: cors });
}

export const OPTIONS = widgetOptions;
