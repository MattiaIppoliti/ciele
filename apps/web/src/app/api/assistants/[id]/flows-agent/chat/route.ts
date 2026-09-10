import { NextRequest } from "next/server";
import { z } from "zod";
import {
  NDJSON_HEADERS,
  sessionMetadata,
  streamConversationTurn,
} from "@agent-hub/agent";
import { OperationError, ensureFlowsAgentOp, flowTriggerSchema } from "@ciele/ops";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { loadFlowBuilderCatalogue } from "@/lib/flow-builder-catalogue";
import { webOperationPorts } from "@/lib/op-ports";
import { canEdit } from "@/lib/rbac";
import { getRuntimeDb } from "@/lib/runtime-db";
import { getServiceRoleDb } from "@/lib/service-db";
import { invalidatePublicationFromRoute } from "@/lib/widget-db";
import { resolveTeammateActions } from "@/lib/teammates/actions";
import { resolvePersonalSubscription } from "@/lib/personal-subscription";
import type { FlowDraft } from "@/lib/flow-editor";
import { draftFromFlow } from "@/lib/flow-editor";
import { flowsAgentGrounding } from "@/lib/flows-agent";

export const maxDuration = 300;

/**
 * The client's draft, loosely: it is rendered into prose for the model and
 * never stored, so the shape matters and the values do not. A malformed body
 * is the caller's error (400), not a crash.
 */
const draftBodySchema = z
  .object({
    name: z.string().max(200),
    // The ops layer's own trigger list, so a fifth trigger (#843) does not
    // leave this route answering 400 to every message on that canvas.
    trigger: flowTriggerSchema.nullable(),
    dwell: z.object({ minutes: z.number().int().min(0), seconds: z.number().int().min(0) }),
    conditionLogic: z.enum(["any", "all"]),
    conditions: z.array(z.record(z.string(), z.unknown())),
    actions: z.array(z.string().max(64)),
    settings: z.record(z.string(), z.unknown()),
    customMessage: z.string().max(20000),
  })
  .partial();

const bodySchema = z.object({
  conversationId: z.string().min(1).nullable().optional(),
  flowId: z.string().min(1).nullable().optional(),
  draft: draftBodySchema.optional(),
  message: z.string(),
  turnId: z.string().min(1).optional(),
});

/**
 * The Flows Agent's turn (#838): the Teammate chat route, for the one system
 * Teammate the canvas talks to.
 *
 * Same `streamConversationTurn`, same personal-subscription routing (the canvas
 * is an internal surface), same grant resolution. What differs is what the turn
 * is told: the open draft and the Assistant's catalogue arrive as standing
 * context, because the canvas is the only place that knows the unsaved draft,
 * and the conversation is tagged with the Flow so the panel's history is per
 * canvas.
 *
 * Editors only. A Viewer's canvas is read-only, so an agent that drafts into
 * it would draft into nothing.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.organization) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!canEdit(session.role)) {
    return new Response("Forbidden", { status: 403 });
  }

  const { id: assistantId } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  const body = parsed.data;
  const message = body.message.trim();
  if (!message) return new Response("Empty message", { status: 400 });
  const flowId = body.flowId ?? null;

  const db = await getDb();
  const assistant = await db.getAssistant(assistantId);
  if (!assistant || assistant.organizationId !== session.organization.id) {
    return new Response("Not found", { status: 404 });
  }

  const ctx = {
    organizationId: session.organization.id,
    userId: session.userId,
    role: session.role ?? "viewer",
    db,
    // The creation grant goes through the system Db (the grant table is
    // admin-only under RLS and this is an Editor's surface); everything else
    // the operation does stays on the session's RLS-scoped `db`.
    ports: webOperationPorts(getServiceRoleDb(), {
      organizationId: session.organization.id,
      actorEmail: session.email,
      invalidatePublication: invalidatePublicationFromRoute,
    }),
  };
  let teammate;
  try {
    teammate = await ensureFlowsAgentOp.run(ctx, { assistantId });
  } catch (error) {
    if (error instanceof OperationError && error.code === "not_found") {
      return new Response("Not found", { status: 404 });
    }
    throw error;
  }

  const [connections, personal, teammateActions, catalogue, assistants] = await Promise.all([
      db.listProviderConnections(session.organization.id),
      resolvePersonalSubscription({
        db,
        organizationId: session.organization.id,
        userId: session.userId,
        host: request.headers.get("host"),
        origin: request.nextUrl.origin,
      }),
      resolveTeammateActions({
        db,
        teammate,
        organizationId: session.organization.id,
        userId: session.userId,
        role: session.role,
        actorEmail: session.email,
      }),
      loadFlowBuilderCatalogue(db, assistant, session.userId),
      db.listAssistants(session.organization.id),
    ]);

  // The draft the client holds is the truth about the open Flow; the stored
  // Flow is only the fallback for a client that sent none, and it goes to the
  // model redacted like every other read of a Flow.
  const draft: FlowDraft = body.draft
    ? { ...draftFromFlow(null), ...(body.draft as Partial<FlowDraft>) }
    : draftFromFlow(
        flowId
          ? (catalogue.flows.find((f) => f.id === flowId) ?? null)
          : null
      );

  const standingContext = flowsAgentGrounding({
    assistant: { id: assistant.id, title: assistant.title },
    flowId,
    draft,
    flows: catalogue.flows,
    helpDesks: catalogue.helpDesks,
    faqs: catalogue.faqs,
    connections: catalogue.connections,
    collections: catalogue.collections,
    assistants: assistants
      .filter((candidate) => candidate.id !== assistantId)
      .map((candidate) => ({ id: candidate.id, title: candidate.title })),
  });

  const profileName =
    [session.profile?.firstName, session.profile?.lastName].filter(Boolean).join(" ") ||
    session.profile?.username ||
    undefined;

  const stream = await streamConversationTurn({
    db,
    systemDb: getRuntimeDb(db),
    teammate,
    teammateActions,
    connections,
    organizationId: session.organization.id,
    subjectType: "member",
    subjectId: session.userId,
    conversationId: body.conversationId,
    message,
    turnId: body.turnId,
    metadata: {
      ...sessionMetadata(request.headers),
      userName: profileName,
      userEmail: session.email,
      userRole: session.role ?? undefined,
      flowsAgent: { assistantId, flowId },
    },
    standingContext,
    keyResolution: {
      surface: "teammate",
      memberId: session.userId,
      localSubscriptionProviders: personal.providers,
      localSubscriptionRunner: personal.runner,
    },
    signal: request.signal,
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}
