import { NextRequest } from "next/server";
import {
  escalateConversation,
  type EscalationRequest,
} from "@/lib/escalation";
import {
  resolveWidgetContext,
  widgetOptions,
  widgetSubject,
} from "@/lib/widget-db";

/**
 * Widget escalation surface: a thin adapter over `escalateConversation`
 * (the whole transaction lives in @/lib/escalation; the escalation *menu*
 * is served by the sibling help-desks route from the one widget-safe
 * channel projection in @/lib/escalation-desks).
 *
 * POST, records that the visitor escalated: marks the conversation escalated
 *        and, if the desk has "Auto-generate improvements" on, creates an
 *        Improvement from the last AI answer. When the body carries a
 *        channelId + form values (an email channel's form submission), the
 *        escalation email is composed from the channel's configured form and
 *        sent through the runtime email transport.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assistantId: string }> }
) {
  const ctx = await resolveWidgetContext(request, params);
  if (ctx instanceof Response) return ctx;
  const { db, assistantId, publication, cors } = ctx;

  const body = (await request.json()) as EscalationRequest;
  const outcome = await escalateConversation({
    db,
    assistantId,
    assistant: publication.config.assistant,
    request: body,
    // Gate-resolved subject (#662): an SSO-signed user escalates as their
    // verified subject; anonymous traffic keeps the visitor-id rule.
    subject: widgetSubject(
      request,
      publication.config.assistant.organizationId,
      (body.visitorId ?? "").trim()
    ),
  });

  switch (outcome.kind) {
    case "bad_request":
      return new Response("Bad request", { status: 400, headers: cors });
    case "not_found":
      return new Response("Not found", { status: 404, headers: cors });
    case "missing_fields":
      return Response.json(
        { error: `Missing required fields: ${outcome.missing.join(", ")}` },
        { status: 400, headers: cors }
      );
    case "endpoint_failed":
      return Response.json(
        { error: "The escalation endpoint could not be reached." },
        { status: 502, headers: cors }
      );
    case "ok":
      return Response.json({ ok: true, email: outcome.email }, { headers: cors });
  }
}

export const OPTIONS = widgetOptions;
