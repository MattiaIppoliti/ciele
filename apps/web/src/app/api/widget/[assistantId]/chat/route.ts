import { NextRequest } from "next/server";
import type { Assistant } from "@agent-hub/core";
import { parseModelSelector, resolveRequestedModel } from "@agent-hub/core";
import {
  NDJSON_HEADERS,
  sessionMetadata,
  streamConversationTurn,
} from "@agent-hub/agent";
import { openAttachments } from "@/lib/attachments";
import { resolveWidgetContext, widgetOptions, widgetSubject } from "@/lib/widget-db";
import { getRuntimeDb } from "@/lib/runtime-db";

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
    turnId?: string;
    /** True when the message came from an FAQ quick reply (verbatim answer). */
    faq?: boolean;
    /**
     * The embedding page, forwarded by the launcher. Validated in
     * `sessionMetadata`, which falls back to the request headers.
     */
    pageUrl?: string | null;
    /**
     * `"<provider>:<model id>"`, picked from the list the config route served.
     * Advisory: the allow-list on the snapshot is what decides, and a selector
     * naming anything else runs the configured model instead of failing.
     */
    model?: string | null;
    /**
     * Sealed attachment tokens from `/attachments`. The client holds them for
     * the conversation and re-sends them, so what is still in scope is what the
     * composer still shows; nothing is kept server-side.
     */
    attachments?: unknown;
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

  // Which model answers this one message (the composer's picker).
  //
  // The client sends a selector, never a model: `resolveRequestedModel` picks
  // from the snapshot's own allow-list and silently returns the configured
  // model for anything else. Silently, because the widget on a customer's page
  // may be running a Publication older than the one serving it, and a Visitor
  // should never pay for that with a refused answer. A Visitor can therefore
  // move this Organization's spend between models its admin chose, and nowhere
  // else, which is also why the empty allow-list, the default, admits nothing.
  const configured = {
    provider: config.assistant.modelProvider,
    modelId: config.assistant.modelId,
  };
  const chosen = resolveRequestedModel(
    parseModelSelector(body.model),
    configured,
    config.assistant.allowedModels ?? []
  );

  // The published widget runs the snapshot config over the live assistant id.
  const assistant: Assistant = {
    ...config.assistant,
    modelProvider: chosen.provider,
    modelId: chosen.modelId,
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
    systemDb: getRuntimeDb(db),
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
    turnId: body.turnId,
    faqQuestion: body.faq === true,
    // Opened here, never trusted from the client: the token is sealed because
    // this text lands in the system prompt.
    attachments: config.assistant.attachmentsEnabled
      ? openAttachments(body.attachments)
      : [],
    metadata,
    signal: request.signal,
  });

  return new Response(stream, { headers: { ...cors, ...NDJSON_HEADERS } });
}

export const OPTIONS = widgetOptions;
