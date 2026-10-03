import { withRequestDiagnostics } from "@/lib/request-diagnostics";
import { NextRequest } from "next/server";
import { parseModelSelector, resolveRequestedModel } from "@agent-hub/core";
import { getSession, profileName } from "@/lib/auth";
import { openAttachments } from "@/lib/attachments";
import { getDb } from "@/lib/data";
import { getRuntimeDb } from "@/lib/runtime-db";
import { resolvePersonalSubscription } from "@/lib/personal-subscription";
import {
  NDJSON_HEADERS,
  sessionMetadata,
  streamConversationTurn,
} from "@agent-hub/agent";
import {
  applyLocalPreviewModelPreference,
  resolveLocalPreviewModelPreference,
} from "@/lib/local-model-options";

export const maxDuration = 300;

/**
 * Preview chat endpoint. Flows, connections and assistant config are re-read
 * per message so admin edits apply immediately (unlike the widget, which is
 * pinned to the latest Publication). The turn itself lives in the
 * Conversation Turn module.
 */
export const POST = withRequestDiagnostics("/api/preview/chat", "preview", async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.organization) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as {
    assistantId: string;
    conversationId?: string | null;
    collectionId?: string | null;
    message: string;
    turnId?: string;
    studyAnswer?: unknown;
    modelPreference?: unknown;
    /** `"<provider>:<model id>"` from the composer's picker; see below. */
    model?: string | null;
    /** Sealed attachment tokens; opened here, never trusted as sent. */
    attachments?: unknown;
  };
  const message = (body.message ?? "").trim();
  if (!message) return new Response("Empty message", { status: 400 });

  const db = await getDb();
  const assistant = await db.getAssistant(body.assistantId);
  if (!assistant || assistant.organizationId !== session.organization.id) {
    return new Response("Not found", { status: 404 });
  }

  const [flows, connections, skills, personal] = await Promise.all([
    db.listFlows(assistant.id),
    db.listProviderConnections(session.organization.id),
    db.listAssistantSkills(assistant.id),
    // This Member's own subscription, if the org allows it and they paired a
    // device. The same resolution the Teammate chat runs (#769).
    resolvePersonalSubscription({
      db,
      organizationId: session.organization.id,
      userId: session.userId,
      host: request.headers.get("host"),
      origin: request.nextUrl.origin,
    }),
  ]);
  const localModelPreference = resolveLocalPreviewModelPreference(
    body.modelPreference,
    personal.providers
  );
  // Two selections, and they are not peers. The composer's picker chooses
  // between the models this Assistant allows, on the Organization's
  // connections. The Member's own subscription, set once in Settings → AI,
  // outranks it: it is their capacity, it costs the Organization nothing, and
  // it is applied second so it wins. Composing them in this order is what
  // makes "your subscription answers whichever model is picked" true here and
  // in the Teammate chat both.
  const chosen = resolveRequestedModel(
    parseModelSelector(body.model),
    {
      provider: assistant.modelProvider,
      modelId: assistant.modelId,
      source: assistant.modelSource ?? undefined,
    },
    assistant.allowedModels ?? []
  );
  const effectiveAssistant = applyLocalPreviewModelPreference(
    {
      ...assistant,
      modelProvider: chosen.provider,
      modelId: chosen.modelId,
      modelSource: chosen.source ?? null,
    },
    body.modelPreference,
    personal.providers
  );

  const stream = await streamConversationTurn({
    db,
    systemDb: getRuntimeDb(db),
    assistant: effectiveAssistant,
    flows,
    skills,
    connections,
    organizationId: session.organization.id,
    subjectType: "member",
    subjectId: session.userId,
    conversationId: body.conversationId,
    collectionId: body.collectionId,
    attachments: openAttachments(body.attachments),
    message,
    turnId: body.turnId,
    studyAnswer: body.studyAnswer,
    metadata: {
      ...sessionMetadata(request.headers),
      userName: profileName(session.profile),
      userEmail: session.email,
      userRole: session.role ?? undefined,
    },
    // Local demo Preview can execute the authenticated CLIs on this same Mac.
    // Hosted subscription rows remain retired and widget traffic never sees
    // these capabilities.
    keyResolution: {
      surface: "preview",
      memberId: session.userId,
      localSubscriptionProviders: personal.providers,
      localSubscriptionRunner: personal.runner,
      localSubscriptionModel: localModelPreference ?? undefined,
    },
    signal: request.signal,
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
});
