import { NextRequest } from "next/server";
import type { Assistant, FlowTrigger } from "@agent-hub/core";
import { isProactiveTrigger } from "@agent-hub/core";
import {
  NDJSON_HEADERS,
  sessionMetadata,
  streamConversationTurn,
} from "@agent-hub/agent";
import { SSO_GATE_COOKIE, isGateValidForOrg } from "@/lib/sso";
import { resolveWidgetContext, widgetOptions } from "@/lib/widget-db";
import { reportedPageUrl } from "@/lib/widget-triggers";

export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * Proactive Flow triggers (#541): the widget reports a client event — the chat
 * opening, and later a page load or a dwell threshold — and the runtime decides
 * whether any Flow answers it.
 *
 * The client reports; it never decides. Which Flows run, whether the nudge has
 * already been delivered, and whether the visitor may be messaged at all are all
 * resolved server-side, so a reopen loop or a replayed report changes nothing. A
 * trigger nothing is configured for streams zero bytes and writes nothing.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assistantId: string }> }
) {
  const ctx = await resolveWidgetContext(request, params);
  if (ctx instanceof Response) return ctx;
  const { db, publication, cors } = ctx;
  const config = publication.config;

  // Same authoritative gate as /chat: an enforced assistant says nothing at all
  // — proactively included — until the visitor holds a valid gate cookie.
  if (
    config.assistant.requireSignIn &&
    !isGateValidForOrg(
      request.cookies.get(SSO_GATE_COOKIE)?.value,
      config.assistant.organizationId
    )
  ) {
    return Response.json(
      { error: "sign_in_required" },
      { status: 401, headers: cors }
    );
  }

  const body = (await request.json()) as {
    visitorId: string;
    conversationId?: string | null;
    collectionId?: string | null;
    trigger: FlowTrigger;
    /** The host page's URL, which only the embedding script can read. */
    pageUrl?: string;
    /** Dwell reported for "Time on page"; re-checked against each flow's own. */
    elapsedSeconds?: number;
  };
  const visitorId = (body.visitorId ?? "").trim();
  if (!visitorId || !body.trigger || !isProactiveTrigger(body.trigger)) {
    return new Response("Bad request", { status: 400, headers: cors });
  }

  // The referer on this request is the chat frame's own URL, so for a floater
  // embed the host page is only knowable from what the script reported. Trusted
  // for display in the Inbox session panel and nothing else — it never selects a
  // flow or grants access.
  const metadata = sessionMetadata(request.headers);
  const launchUrl = reportedPageUrl(body.pageUrl) ?? metadata.launchUrl;

  const assistant: Assistant = {
    ...config.assistant,
    createdAt: publication.createdAt,
    updatedAt: publication.createdAt,
  };

  const stream = await streamConversationTurn({
    db,
    assistant,
    flows: config.flows,
    skills: config.skills ?? [],
    // A proactive turn calls no model, so it needs no credential — the empty
    // list keeps that explicit rather than incidental.
    connections: [],
    organizationId: config.assistant.organizationId,
    subjectType: "visitor",
    subjectId: visitorId,
    conversationId: body.conversationId,
    collectionId: body.collectionId,
    message: "",
    trigger: body.trigger,
    triggerContext: {
      ...(typeof body.elapsedSeconds === "number"
        ? { elapsedSeconds: body.elapsedSeconds }
        : {}),
    },
    metadata: { ...metadata, ...(launchUrl ? { launchUrl } : {}) },
    signal: request.signal,
  });

  return new Response(stream, { headers: { ...cors, ...NDJSON_HEADERS } });
}

export const OPTIONS = widgetOptions;
