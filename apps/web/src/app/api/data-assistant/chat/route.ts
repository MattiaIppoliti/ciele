import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";
import {
  NDJSON_HEADERS,
  sessionMetadata,
  streamConversationTurn,
} from "@agent-hub/agent";

export const maxDuration = 300;

/**
 * Org-staff data assistant (#668): signed-in Members ask questions over the
 * Organization's imported Records. Same conversation-turn pipeline as the
 * live Preview (member subject — the turn's tool policy is what gives
 * members cross-record access over user-scoped Entities), no Publication,
 * no SSO gate. The Entity set is the org-level data-assistant selection,
 * deliberately separate from any customer-facing assistant's selection;
 * flows are omitted so every turn runs the default agentic behavior over
 * the retrieval tools. Members never read or write long-term Memories —
 * that path gates on SSO subjects.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.organization) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as {
    conversationId?: string | null;
    message: string;
  };
  const message = (body.message ?? "").trim();
  if (!message) return new Response("Empty message", { status: 400 });

  const db = await getDb();
  const organizationId = session.organization.id;
  const [assistants, connections, selectedIds, orgEntities] = await Promise.all([
    db.listAssistants(organizationId),
    db.listProviderConnections(organizationId),
    db.getDataAssistantEntityIds(organizationId),
    db.table("entities").list({ organizationId }),
  ]);
  // The turn pipeline needs an assistant for model config and conversation
  // ownership; the org's first assistant serves as that anchor. Its flows
  // and per-assistant entity selection are deliberately NOT used here.
  const assistant = assistants[0];
  if (!assistant) {
    return new Response("Create an assistant first", { status: 409 });
  }
  const entities = orgEntities.filter((e) => selectedIds.includes(e.id));

  const profileName =
    [session.profile?.firstName, session.profile?.lastName]
      .filter(Boolean)
      .join(" ") ||
    session.profile?.username ||
    undefined;

  const stream = await streamConversationTurn({
    db,
    assistant,
    flows: [],
    skills: [],
    entities,
    connections,
    organizationId,
    subjectType: "member",
    subjectId: session.userId,
    conversationId: body.conversationId,
    message,
    metadata: {
      ...sessionMetadata(request.headers),
      userName: profileName,
      userEmail: session.email,
      userRole: session.role ?? undefined,
    },
    keyResolution: { surface: "preview", memberId: session.userId },
    signal: request.signal,
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}
