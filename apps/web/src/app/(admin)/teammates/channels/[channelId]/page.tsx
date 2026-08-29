import { notFound } from "next/navigation";
import { OperationError, getChannelOp } from "@ciele/ops";
import { canAddTeammateToChannel, memberDisplayName } from "@agent-hub/core";
import { canViewReasoning } from "@/lib/rbac";
import { ChannelWorkspace } from "@/components/teammates/channel-workspace";
import { requirePageMember } from "@/lib/authz";
import { runOperation } from "@/lib/operations";

export const dynamic = "force-dynamic";

/**
 * One channel: the shared transcript, its roster, and who can be added to it.
 *
 * The read goes through the operation rather than the Db, because membership is
 * the visibility rule and `getChannelOp` is where it is enforced. A colleague who
 * was not invited gets `not_found`, which this turns into a 404: a channel they
 * are not in does not exist for them.
 */
export default async function ChannelPage({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const { channelId } = await params;
  const { organizationId, role, session, db } = await requirePageMember();

  let view;
  try {
    view = await runOperation(getChannelOp, { id: channelId });
  } catch (error) {
    if (error instanceof OperationError && error.code === "not_found") {
      notFound();
    }
    throw error;
  }

  const [members, teammates, projects] = await Promise.all([
    db.listMembers(organizationId),
    db.table("teammates").list({ organizationId, deletedAt: null }),
    db.table("projects").list({ organizationId }),
  ]);

  const viewer = { userId: session.userId, role: role ?? "viewer" };
  const seatedMembers = new Set(
    view.participants.map((row) => row.userId).filter(Boolean)
  );
  const seatedTeammates = new Set(
    view.participants.map((row) => row.teammateId).filter(Boolean)
  );

  return (
    <ChannelWorkspace
      channel={view.channel}
      roster={view.roster}
      teammates={view.teammates}
      messages={view.messages}
      canManage={view.canManage}
      canViewReasoning={canViewReasoning(role)}
      currentUserId={session.userId}
      /** Colleagues not in the channel yet. */
      invitableMembers={members
        .filter((member) => !seatedMembers.has(member.userId))
        .map((member) => ({
          userId: member.userId,
          label: memberDisplayName(member),
        }))}
      /**
       * Teammates that can be seated: the org-visible ones, plus this Member's
       * own private ones. The same rule the operation enforces, applied here so
       * the picker never offers something the server will refuse.
       */
      addableTeammates={teammates
        .filter(
          (teammate) =>
            !seatedTeammates.has(teammate.id) &&
            canAddTeammateToChannel(teammate, viewer)
        )
        .map((teammate) => ({
          id: teammate.id,
          name: teammate.name,
          title: teammate.title,
          avatarSeed: teammate.avatarSeed,
        }))}
      projects={projects
        // An archived Project's decisions are read-only and reach no prompt, so
        // binding a channel to one would bind it to nothing.
        .filter((project) => !project.archived)
        .map((project) => ({ id: project.id, name: project.name }))}
    />
  );
}
