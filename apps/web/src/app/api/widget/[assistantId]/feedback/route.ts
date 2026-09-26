import { NextRequest } from "next/server";
import {
  feedbackReactionScore,
  isFeedbackReactionId,
} from "@agent-hub/core";
import { resolveWidgetContext, widgetOptions } from "@/lib/widget-db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assistantId: string }> }
) {
  const ctx = await resolveWidgetContext(request, params);
  if (ctx instanceof Response) return ctx;

  const body = (await request.json()) as {
    messageId: string;
    feedback?: -1 | 0 | 1;
    reaction?: unknown;
  };
  const hasReaction = Object.prototype.hasOwnProperty.call(body, "reaction");
  const reaction = isFeedbackReactionId(body.reaction) ? body.reaction : null;
  if (
    !body.messageId ||
    (hasReaction && body.reaction !== null && !isFeedbackReactionId(body.reaction)) ||
    (!hasReaction && ![-1, 0, 1].includes(body.feedback ?? 99))
  ) {
    return new Response("Bad request", { status: 400, headers: ctx.cors });
  }
  const feedback = hasReaction
    ? feedbackReactionScore(reaction)
    : body.feedback!;
  await ctx.db.setMessageFeedback(body.messageId, feedback, hasReaction ? reaction : null);
  return Response.json({ ok: true }, { headers: ctx.cors });
}

export const OPTIONS = widgetOptions;
