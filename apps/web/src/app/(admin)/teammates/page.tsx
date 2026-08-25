import { rosterTeammates, visibleTeammates, memberDisplayName } from "@agent-hub/core";
import { listChannelsOp } from "@ciele/ops";
import { TeammatesClient } from "@/components/teammates/teammates-client";
import { requirePageMember } from "@/lib/authz";
import { runOperation } from "@/lib/operations";
import { canEdit } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/**
 * The Teammates roster (#768): the organization's internal AI colleagues, and
 * since #778 the channels they share with the team.
 *
 * The list is filtered by the same rule the operations layer enforces, so a
 * private Teammate never reaches the browser of a colleague who may not see it.
 * On top of that comes each Member's own hiding (#767, story 10), which is a
 * preference about this list and nothing more: the hidden ones are handed over
 * separately so they can be put back.
 *
 * Channels ride the same page rather than a nav entry of their own, because a
 * Member looking for "where I talk to teammates" should find one place (#776).
 */
export default async function TeammatesPage() {
  const { organizationId, role, session, db } = await requirePageMember();

  const [teammates, collections, hiddenRows, channels, members, projects] =
    await Promise.all([
      db.table("teammates").list({ organizationId, deletedAt: null }),
      db.listOrgCollections(organizationId),
      db.table("teammateRosterHidden").list({
        organizationId,
        userId: session.userId,
      }),
      // Membership is the visibility rule, and the operation is where it lives.
      runOperation(listChannelsOp, {}),
      db.listMembers(organizationId),
      // The create dialog's project section offers the live ones (#771).
      db.table("projects").list({ organizationId }),
    ]);

  const viewer = { userId: session.userId, role: role ?? "viewer" };
  const hiddenIds = hiddenRows.map((row) => row.teammateId);
  const hidden = new Set(hiddenIds);

  return (
    <TeammatesClient
      teammates={rosterTeammates(teammates, viewer, hiddenIds)}
      hidden={visibleTeammates(teammates, viewer).filter((teammate) =>
        hidden.has(teammate.id)
      )}
      channels={channels.map((summary) => ({
        id: summary.channel.id,
        name: summary.channel.name,
        memberCount: summary.memberIds.length,
        teammateCount: summary.teammateIds.length,
        unread: summary.unread,
        lastMessagePreview: summary.lastMessagePreview,
      }))}
      members={members
        .filter((member) => member.userId !== session.userId)
        .map((member) => ({
          userId: member.userId,
          label: memberDisplayName(member),
        }))}
      collections={collections.map((c) => ({ id: c.id, name: c.name }))}
      projects={projects
        // Archived projects keep their decisions and stop feeding them to a
        // model, so attaching to one would be attaching to nothing.
        .filter((project) => !project.archived)
        .map((project) => ({ id: project.id, name: project.name }))}
      canEdit={canEdit(role)}
    />
  );
}
