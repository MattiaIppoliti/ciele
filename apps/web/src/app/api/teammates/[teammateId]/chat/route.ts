import { NextRequest } from "next/server";
import { isTeammateRetired, referralCandidates } from "@agent-hub/core";
import {
  NDJSON_HEADERS,
  sessionMetadata,
  streamConversationTurn,
} from "@agent-hub/agent";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { findVisibleTeammate } from "@/lib/teammates/access";
import { resolveTeammateActions } from "@/lib/teammates/actions";
import { resolvePersonalSubscription } from "@/lib/personal-subscription";

export const maxDuration = 300;

/**
 * Teammate chat (#768). The same Conversation Turn the Preview and the widget
 * run, handed a Teammate instead of an Assistant: persona layer, Knowledge
 * Scope, and a Conversation owned by the Teammate.
 *
 * Config is re-read per message, like the Preview and unlike the widget, which
 * is what makes an edited Standing Role apply to the next turn with no
 * publish step in between.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ teammateId: string }> }
) {
  const session = await getSession();
  if (!session?.organization) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { teammateId } = await params;
  const body = (await request.json()) as {
    conversationId?: string | null;
    message: string;
  };
  const message = (body.message ?? "").trim();
  if (!message) return new Response("Empty message", { status: 400 });

  const db = await getDb();
  // Same refusal for "no such teammate" and "not yours": a colleague must not
  // learn that someone's private Teammate exists.
  const teammate = await findVisibleTeammate(
    db,
    session.organization.id,
    teammateId,
    { userId: session.userId, role: session.role }
  );
  if (!teammate) return new Response("Not found", { status: 404 });
  // Readable is not answerable: a retired Teammate keeps its transcripts and
  // takes no new turn (#767).
  if (isTeammateRetired(teammate)) {
    return new Response("This teammate was deleted", { status: 410 });
  }

  const [connections, personal, teammateActions, roster] = await Promise.all([
    db.listProviderConnections(session.organization.id),
    // A Member's own subscription may power their own Teammate turns
    // (ADR-0007 as amended by #769). Keyed on the invoking Member, so a
    // colleague chatting with the same Teammate resolves their own devices,
    // which is to say none, and runs on the Organization's connections.
    resolvePersonalSubscription({
      db,
      organizationId: session.organization.id,
      userId: session.userId,
      host: request.headers.get("host"),
      origin: request.nextUrl.origin,
    }),
    // What this Teammate was granted (#770). Resolved per turn like the rest of
    // its config, so revoking a grant lands on the next message with no
    // republish, exactly like editing the Standing Role.
    resolveTeammateActions({
      db,
      teammate,
      organizationId: session.organization.id,
      userId: session.userId,
      role: session.role,
      actorEmail: session.email,
    }),
    // Who this Teammate could refer to (#773). Read here, and resolved against
    // the Member rather than the Teammate: a card naming something they cannot
    // open is a dead end, and one naming a private Teammate discloses it.
    db.table("teammates").list({ organizationId: session.organization.id }),
  ]);
  const profileName =
    [session.profile?.firstName, session.profile?.lastName]
      .filter(Boolean)
      .join(" ") ||
    session.profile?.username ||
    undefined;

  const stream = await streamConversationTurn({
    db,
    teammate,
    teammateActions,
    referralCandidates: referralCandidates(roster, teammate, {
      userId: session.userId,
      role: session.role ?? "viewer",
    }),
    // A Teammate has no Flows; the runtime routes its one implicit default.
    flows: [],
    connections,
    organizationId: session.organization.id,
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
    // The credential surface, one of the two the ADR-0007 amendment names as
    // allowed to run on a personal subscription (the other is the owner's
    // Preview). An unattended Routine run will pass no `memberId`, which is
    // what keeps it on Organization connections (#772).
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
