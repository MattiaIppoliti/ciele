import { NextRequest } from "next/server";
import type { FlowTrigger } from "@agent-hub/core";
import {
  isProactiveTrigger,
  proactiveDwellSeconds,
  proactiveTriggers,
} from "@agent-hub/core";
import {
  NDJSON_HEADERS,
  sessionMetadata,
  streamConversationTurn,
} from "@agent-hub/agent";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";

export const maxDuration = 60;

/**
 * Proactive triggers in the editor's live Preview (#545).
 *
 * Deliberately thinner than the preview chat endpoint: a proactive turn resolves
 * no model, so none of the local-subscription plumbing applies. Flows are read
 * live, which is the point — an admin has to be able to watch an unpublished nudge
 * behave before publishing it. The published Widget keeps serving the latest
 * Publication, so a draft still never reaches a real Visitor.
 */
/**
 * Which proactive triggers the assistant's **live** flows have, so the Preview
 * arms the same listeners the embed would. The widget reads the equivalent from
 * the published config; Preview cannot, because the whole point is unpublished
 * work.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.organization) {
    return new Response("Unauthorized", { status: 401 });
  }
  const assistantId = request.nextUrl.searchParams.get("assistantId") ?? "";
  const db = await getDb();
  const assistant = await db.getAssistant(assistantId);
  if (!assistant || assistant.organizationId !== session.organization.id) {
    return new Response("Not found", { status: 404 });
  }
  const flows = await db.listFlows(assistant.id);
  return Response.json(
    {
      proactiveTriggers: proactiveTriggers(flows),
      proactiveDwellSeconds: proactiveDwellSeconds(flows),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.organization) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as {
    assistantId: string;
    conversationId?: string | null;
    collectionId?: string | null;
    trigger: FlowTrigger;
    elapsedSeconds?: number;
  };
  if (!body.trigger || !isProactiveTrigger(body.trigger)) {
    return new Response("Bad request", { status: 400 });
  }

  const db = await getDb();
  const assistant = await db.getAssistant(body.assistantId);
  if (!assistant || assistant.organizationId !== session.organization.id) {
    return new Response("Not found", { status: 404 });
  }

  const [flows, connections, skills] = await Promise.all([
    db.listFlows(assistant.id),
    db.listProviderConnections(session.organization.id),
    db.listAssistantSkills(assistant.id),
  ]);
  const profileName =
    [session.profile?.firstName, session.profile?.lastName]
      .filter(Boolean)
      .join(" ") || session.profile?.username || undefined;

  const stream = await streamConversationTurn({
    db,
    assistant,
    flows,
    skills,
    connections,
    organizationId: session.organization.id,
    subjectType: "member",
    subjectId: session.userId,
    conversationId: body.conversationId,
    collectionId: body.collectionId,
    message: "",
    trigger: body.trigger,
    triggerContext: {
      ...(typeof body.elapsedSeconds === "number"
        ? { elapsedSeconds: body.elapsedSeconds }
        : {}),
    },
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
