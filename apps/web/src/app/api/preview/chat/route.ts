import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";
import {
  createRelayCliRunner,
  listActiveRelayProviders,
} from "@/lib/local-inference-relay";
import {
  createLocalCliRunner,
  verifiedLocalSubscriptionProviders,
  type LocalCliRunner,
} from "@agent-hub/agent/local-providers";
import {
  connectedLocalSubscriptionProviders,
  isLocalSubscriptionDirectEnabled,
  isLoopbackHost,
  listLocalSubscriptionStatuses,
} from "@agent-hub/agent/local-providers";
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
    modelPreference?: unknown;
  };
  const message = (body.message ?? "").trim();
  if (!message) return new Response("Empty message", { status: 400 });

  const db = await getDb();
  const assistant = await db.getAssistant(body.assistantId);
  if (!assistant || assistant.organizationId !== session.organization.id) {
    return new Response("Not found", { status: 404 });
  }

  const [flows, connections, skills, personalSubscriptionsAllowed] = await Promise.all([
    db.listFlows(assistant.id),
    db.listProviderConnections(session.organization.id),
    db.listAssistantSkills(assistant.id),
    db.getPersonalAiSubscriptionsAllowed(session.organization.id),
  ]);
  const directLocal =
    personalSubscriptionsAllowed &&
    isLocalSubscriptionDirectEnabled() &&
    isLoopbackHost(request.headers.get("host"));
  let localSubscriptionProviders = [] as ReturnType<
    typeof connectedLocalSubscriptionProviders
  >;
  let localSubscriptionRunner: LocalCliRunner | undefined;
  if (directLocal) {
    localSubscriptionRunner = createLocalCliRunner();
    localSubscriptionProviders = await verifiedLocalSubscriptionProviders(
      connectedLocalSubscriptionProviders(await listLocalSubscriptionStatuses()),
      localSubscriptionRunner
    );
  }
  // The paired Ciele Connector stays usable even when the direct local-CLI
  // test path is enabled but has nothing connected (e.g. a CLI is missing on
  // this machine and the Member authorized from Terminal instead).
  if (personalSubscriptionsAllowed && localSubscriptionProviders.length === 0) {
    try {
      localSubscriptionProviders = await listActiveRelayProviders({
        organizationId: session.organization.id,
        userId: session.userId,
        origin: request.nextUrl.origin,
      });
      if (localSubscriptionProviders.length > 0) {
        localSubscriptionRunner = createRelayCliRunner({
          organizationId: session.organization.id,
          userId: session.userId,
          origin: request.nextUrl.origin,
        });
      }
    } catch (error) {
      console.error("[preview] local connector relay unavailable:", error);
    }
  }
  const profileName = [session.profile?.firstName, session.profile?.lastName]
    .filter(Boolean)
    .join(" ") || session.profile?.username || undefined;
  const localModelPreference = resolveLocalPreviewModelPreference(
    body.modelPreference,
    localSubscriptionProviders
  );
  const effectiveAssistant = applyLocalPreviewModelPreference(
    assistant,
    body.modelPreference,
    localSubscriptionProviders
  );

  const stream = await streamConversationTurn({
    db,
    assistant: effectiveAssistant,
    flows,
    skills,
    connections,
    organizationId: session.organization.id,
    subjectType: "member",
    subjectId: session.userId,
    conversationId: body.conversationId,
    collectionId: body.collectionId,
    message,
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
      localSubscriptionProviders,
      localSubscriptionRunner,
      localSubscriptionModel: localModelPreference ?? undefined,
    },
    signal: request.signal,
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}
