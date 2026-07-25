import { NextRequest } from "next/server";
import type { Assistant } from "@agent-hub/db";
import {
  NDJSON_HEADERS,
  sessionMetadata,
  streamConversationTurn,
} from "@/lib/runtime";
import { SSO_GATE_COOKIE, isGateValidForOrg } from "@/lib/sso";
import { resolveWidgetContext, widgetOptions } from "@/lib/widget-db";

export const maxDuration = 300;
export const runtime = "nodejs";

/**
 * Public widget chat. Always serves the latest Publication (snapshot
 * semantics) — admin edits are invisible here until the next Publish.
 * The turn itself (conversation, persistence, engine, effects, stream)
 * lives in the Conversation Turn module.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assistantId: string }> }
) {
  const ctx = await resolveWidgetContext(request, params);
  if (ctx instanceof Response) return ctx;
  const { db, publication, cors } = ctx;
  const config = publication.config;

  // The authoritative gate: an enforced assistant answers nothing until the
  // visitor holds a valid gate cookie for its org (the widget UI is only UX).
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
    message: string;
    /** True when the message came from an FAQ quick reply (verbatim answer). */
    faq?: boolean;
  };
  const message = (body.message ?? "").trim();
  const visitorId = (body.visitorId ?? "").trim();
  if (!message || !visitorId) {
    return new Response("Bad request", { status: 400, headers: cors });
  }

  // The published widget runs the snapshot config over the live assistant id.
  const assistant: Assistant = {
    ...config.assistant,
    createdAt: publication.createdAt,
    updatedAt: publication.createdAt,
  };

  const connections = await db.listProviderConnections(
    config.assistant.organizationId
  );

  const stream = await streamConversationTurn({
    db,
    assistant,
    flows: config.flows,
    skills: config.skills ?? [],
    connections,
    organizationId: config.assistant.organizationId,
    subjectType: "visitor",
    subjectId: visitorId,
    conversationId: body.conversationId,
    collectionId: body.collectionId,
    message,
    faqQuestion: body.faq === true,
    metadata: sessionMetadata(request.headers),
    signal: request.signal,
  });

  return new Response(stream, { headers: { ...cors, ...NDJSON_HEADERS } });
}

export const OPTIONS = widgetOptions;
