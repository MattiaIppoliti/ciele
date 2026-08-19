import { NextRequest } from "next/server";
import type { Assistant } from "@agent-hub/core";
import {
  NDJSON_HEADERS,
  sessionMetadata,
  streamConversationTurn,
} from "@agent-hub/agent";
import { resolveWidgetContext, widgetOptions, widgetSubject } from "@/lib/widget-db";

export const maxDuration = 300;
export const runtime = "nodejs";

/**
 * Public widget chat. Always serves the latest Publication (snapshot
 * semantics), admin edits are invisible here until the next Publish.
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

  // Who is speaking (#662): a valid SSO gate replaces the client-generated
  // visitor id with the verified subject; anonymous traffic is unchanged.
  // Resolved from cookies only, so the gate check runs before the body is
  // even parsed, an enforced assistant 401s whatever the payload looks like.
  const gated = widgetSubject(request, config.assistant.organizationId, "");

  // The authoritative gate: an enforced assistant answers nothing until the
  // visitor holds a valid gate cookie for its org (the widget UI is only UX).
  if (config.assistant.requireSignIn && !gated.gate) {
    return Response.json(
      { error: "sign_in_required" },
      { status: 401, headers: cors }
    );
  }

  let body: {
    visitorId: string;
    conversationId?: string | null;
    collectionId?: string | null;
    message: string;
    /** True when the message came from an FAQ quick reply (verbatim answer). */
    faq?: boolean;
    /**
     * The embedding page, forwarded by the launcher. Validated in
     * `sessionMetadata`, which falls back to the request headers.
     */
    pageUrl?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400, headers: cors });
  }
  const message = (body.message ?? "").trim();
  const visitorId = (body.visitorId ?? "").trim();
  const subject = gated.gate
    ? gated
    : { ...gated, id: visitorId };

  if (!message || !subject.id) {
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

  // The verified identity claim rides the conversation's session context so
  // the Inbox (and template variables) can show who was signed in. Verified
  // server-side from the sealed gate, never a client-supplied value.
  // Computed ONCE, with the embed-reported page URL: a second header-only
  // sessionMetadata spread on top used to clobber the pageUrl-derived
  // launchUrl with the header fallback, breaking URL Flow Conditions.
  const metadata = sessionMetadata(request.headers, body.pageUrl ?? undefined);
  if (subject.gate?.claim) {
    metadata.ssoClaimName = subject.gate.claim.name;
    metadata.ssoClaimValue = subject.gate.claim.value;
    if (subject.gate.claim.name === "email" && !metadata.userEmail) {
      metadata.userEmail = subject.gate.claim.value;
    }
  }

  const stream = await streamConversationTurn({
    db,
    assistant,
    flows: config.flows,
    skills: config.skills ?? [],
    entities: config.entities ?? [],
    connections,
    organizationId: config.assistant.organizationId,
    subjectType: subject.type,
    subjectId: subject.id,
    verifiedIdentity: subject.gate
      ? { subjectId: subject.gate.subjectId, claim: subject.gate.claim }
      : undefined,
    conversationId: body.conversationId,
    collectionId: body.collectionId,
    message,
    faqQuestion: body.faq === true,
    metadata,
    signal: request.signal,
  });

  return new Response(stream, { headers: { ...cors, ...NDJSON_HEADERS } });
}

export const OPTIONS = widgetOptions;
