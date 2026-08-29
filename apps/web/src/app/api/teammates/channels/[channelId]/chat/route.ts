import { NextRequest } from "next/server";
import { CHANNEL_NDJSON_HEADERS, streamChannelChain } from "@agent-hub/agent";
import { postChannelMessageOp } from "@ciele/ops";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { resolveTeammateActions } from "@/lib/teammates/actions";
import { runOperation } from "@/lib/operations";

export const maxDuration = 300;

/**
 * A message in a Teammate channel, and everything it sets off (#778).
 *
 * Two halves, and the split is deliberate. The **message** goes through
 * `postChannelMessageOp`, so the membership rule, the mention resolution and the
 * durable write are the operations layer's and are tested there. The **chain** is
 * the runtime's: `streamChannelChain` runs one turn per addressed Teammate,
 * queues whoever they address, and stops at the caps.
 *
 * Nothing here decides who may answer. The operation returns the targets, which
 * are the Teammates the message named and that are seated and live; a Teammate
 * nobody named takes no turn, and there is no branch that could make it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const session = await getSession();
  if (!session?.organization) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { channelId } = await params;
  const body = (await request.json()) as { message?: string };
  const message = (body.message ?? "").trim();
  if (!message) return new Response("Empty message", { status: 400 });

  // The operation refuses with `not_found` for a channel this Member is not in,
  // which is the same answer it gives for one that does not exist.
  const posted = await runOperation(postChannelMessageOp, {
    id: channelId,
    message,
  });

  const db = await getDb();
  const connections = await db.listProviderConnections(session.organization.id);
  const profileName =
    [session.profile?.firstName, session.profile?.lastName]
      .filter(Boolean)
      .join(" ") ||
    session.profile?.username ||
    session.email ||
    undefined;

  const stream = await streamChannelChain({
    db,
    organizationId: session.organization.id,
    channel: posted.channel,
    roster: posted.roster,
    teammates: posted.teammates,
    connections,
    startMessage: posted.message,
    // Every turn in the chain, and every mutation a granted Teammate makes
    // inside it, records this Member (#778, story 8).
    startedBy: { userId: session.userId, name: profileName },
    targets: posted.targets,
    teammateActions: (teammate) =>
      resolveTeammateActions({
        db,
        teammate,
        organizationId: session.organization!.id,
        userId: session.userId,
        role: session.role,
        actorEmail: session.email,
        // The channel's bound Project is where this thread's decisions belong,
        // so it wins over whatever the Teammate is attached to elsewhere
        // (#776, story 11). With no binding, its own Project stands.
        projectId: posted.channel.projectId ?? teammate.projectId,
      }),
    signal: request.signal,
  });

  return new Response(stream, { headers: CHANNEL_NDJSON_HEADERS });
}
