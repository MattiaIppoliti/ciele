import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
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
export async function POST(request: NextRequest) {
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
    modelPreference?: unknown;
  };
  const message = (body.message ?? "").trim();
  if (!message) return new Response("Empty message", { status: 400 });

  const db = await getDb();
  const assistant = await db.getAssistant(body.assistantId);
  if (!assistant || assistant.organizationId !== session.organization.id) {
    return new Response("Not found", { status: 404 });
  }

  const [flows, connections, skills, orgEntities, personal] = await Promise.all([
    db.listFlows(assistant.id),
    db.listProviderConnections(session.organization.id),
    db.listAssistantSkills(assistant.id),
    db.table("entities").list({ organizationId: session.organization.id }),
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
  // Live counterpart of the Publication's entity snapshot (#665): the
  // assistant's selected shared Entities, re-read per message like flows.
  const selectedEntityIds = assistant.tools?.entities ?? [];
  const entities = orgEntities.filter(
    (e) => selectedEntityIds.includes(e.id)
  );
  const profileName = [session.profile?.firstName, session.profile?.lastName]
    .filter(Boolean)
    .join(" ") || session.profile?.username || undefined;
  const localModelPreference = resolveLocalPreviewModelPreference(
    body.modelPreference,
    personal.providers
  );
  const effectiveAssistant = applyLocalPreviewModelPreference(
    assistant,
    body.modelPreference,
    personal.providers
  );

  const stream = await streamConversationTurn({
    db,
    systemDb: getRuntimeDb(db),
    assistant: effectiveAssistant,
    flows,
    skills,
    entities,
    connections,
    organizationId: session.organization.id,
    subjectType: "member",
    subjectId: session.userId,
    conversationId: body.conversationId,
    collectionId: body.collectionId,
    message,
    turnId: body.turnId,
    metadata: {
      ...sessionMetadata(request.headers),
      userName: profileName,
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
}
