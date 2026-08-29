import { rosterTeammates, visibleTeammates, memberDisplayName } from "@agent-hub/core";
import { listChannelsOp } from "@ciele/ops";
import { TeammatesClient } from "@/components/teammates/teammates-client";
import { requirePageMember } from "@/lib/authz";
import { runOperation } from "@/lib/operations";
import { canEdit } from "@/lib/rbac";
import { loadScopeSources } from "@/lib/teammates/settings-props";
import { teammateAvatarSeed } from "@/lib/avatar";

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

  const [
    teammates,
    collections,
    libraryItems,
    hiddenRows,
    channels,
    members,
    projects,
  ] = await Promise.all([
      db.table("teammates").list({ organizationId, deletedAt: null }),
      db.listOrgCollections(organizationId),
      // The card names what a Teammate knows, and a scope can name individual
      // Library items, so the roster needs the same list the picker offers.
      loadScopeSources(db, organizationId),
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
        // Everybody in the room, Teammates first and then people, because the
        // card draws at most two and the agents are what a group on this page
        // leads with. A group with no Teammate in it yet still gets faces,
        // which is the whole reason this is not the Teammate list.
        //
        // Resolved here rather than looked up in the browser: a Teammate's seed
        // lives on its row, a person's is their user id, and the roster the
        // client holds is already narrowed by visibility and by this Member's
        // own hiding, so a seat they hid would have lost its face while still
        // counting towards the total.
        faces: [
          ...summary.teammateIds.flatMap((id) => {
            const teammate = teammates.find((row) => row.id === id);
            return teammate
              ? [{ id, seed: teammateAvatarSeed(teammate) }]
              : [];
          }),
          ...summary.memberIds.map((id) => ({ id, seed: id })),
        ].slice(0, 2),
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
      sources={libraryItems.sources}
      sourcesTruncated={libraryItems.truncated}
      projects={projects
        // Archived projects keep their decisions and stop feeding them to a
        // model, so attaching to one would be attaching to nothing.
        .filter((project) => !project.archived)
        .map((project) => ({ id: project.id, name: project.name }))}
      canEdit={canEdit(role)}
    />
  );
}
