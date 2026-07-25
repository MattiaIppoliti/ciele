import { after, NextRequest } from "next/server";
import { feedbackScore, forwardGraphFeedback } from "@/lib/runtime";
import { resolveWidgetContext, widgetOptions } from "@/lib/widget-db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assistantId: string }> }
) {
  const ctx = await resolveWidgetContext(request, params);
  if (ctx instanceof Response) return ctx;

  const body = (await request.json()) as { messageId: string; feedback: -1 | 0 | 1 };
  if (!body.messageId || ![-1, 0, 1].includes(body.feedback)) {
    return new Response("Bad request", { status: 400, headers: ctx.cors });
  }
  await ctx.db.setMessageFeedback(body.messageId, body.feedback);
  // A 👍/👎 on a graph-served answer re-weights its Retrieval Trace (#389).
  // Runs AFTER the response (the vote is already durably saved) so the worker
  // call never adds latency to the visitor's click; inert for vector answers /
  // no worker. A cleared vote (0) carries no signal.
  if (body.feedback !== 0) {
    const { db, publication } = ctx;
    const vote = body.feedback;
    const messageId = body.messageId;
    after(() =>
      forwardGraphFeedback({
        db,
        organizationId: publication.config.assistant.organizationId,
        messageId,
        score: feedbackScore(vote),
      })
    );
  }
  return Response.json({ ok: true }, { headers: ctx.cors });
}

export const OPTIONS = widgetOptions;
