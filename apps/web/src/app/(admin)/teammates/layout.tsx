import { rosterTeammates, visibleTeammates, memberDisplayName } from "@agent-hub/core";
import { listChannelsOp } from "@ciele/ops";
import { TeammatesShell, type TeammatesShellData } from "@/components/teammates/teammates-client";
import { requirePageMember } from "@/lib/authz";
import { runOperation } from "@/lib/operations";
import { canEdit } from "@/lib/rbac";
import { loadScopeSources } from "@/lib/teammates/settings-props";
import { teammateAvatarSeed } from "@/lib/avatar";
import { ensureCieleAi } from "@/lib/teammates/ciele-ai";

export const dynamic = "force-dynamic";

/**
 * The Teammates conversation rail (#768, #778), and whichever thread is open
 * beside it.
 *
 * A layout rather than a page, so the rail is loaded once and survives
 * navigation between a Teammate, a group and a configuration page: the same
 * shape the Inbox has, for the same reason. `/teammates` itself renders only
 * the placeholder that fills the right pane until something is picked.
 *
 * The list is filtered by the same rule the operations layer enforces, so a
 * private Teammate never reaches the browser of a colleague who may not see it.
 * On top of that comes each Member's own hiding (#767, story 10), which is a
 * preference about this list and nothing more: the hidden ones are handed over
 * separately so they can be put back.
 *
 * Channels ride the same rail rather than a nav entry of their own, because a
 * Member looking for "where I talk to teammates" should find one place (#776).
 */
export default function TeammatesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Not awaited: the rail loads inside the shell's own Suspense, so the open
  // thread's loading.tsx (and the thread itself) never waits for seven reads.
  return <TeammatesShell data={loadShellData()}>{children}</TeammatesShell>;
}

async function loadShellData(): Promise<TeammatesShellData> {
  const { organizationId, role, session, db } = await requirePageMember();

  const [
    teammates,
    collections,
    libraryItems,
    hiddenRows,
    channels,
    members,
    projects,
    cieleAi,
  ] = await Promise.all([
    db.table("teammates").list({ organizationId, deletedAt: null }),
    db.listOrgCollections(organizationId),
    // The create dialog's Knowledge Scope picker offers individual Library
    // items beside the Collections, so the rail loads the same list.
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
    // The Organization's default AI layer, created on the first visit. A
    // system Teammate, so the roster rule leaves it out and it is handed over
    // on its own, pinned first in the sidebar.
    ensureCieleAi(organizationId, session.userId),
  ]);

  const viewer = { userId: session.userId, role: role ?? "viewer" };
  const hiddenIds = hiddenRows.map((row) => row.teammateId);
  const hidden = new Set(hiddenIds);
  const roster = rosterTeammates(teammates, viewer, hiddenIds);

  // The sidebar's history: this Member's own threads, only with Teammates
  // still on their roster, so hiding one tidies its chats away with it.
  const conversations = await db.listMemberTeammateConversations(
    [cieleAi.id, ...roster.map((teammate) => teammate.id)],
    session.userId
  );

  return {
    cieleAi,
    teammates: roster,
    conversations: conversations.flatMap((conversation) =>
      conversation.teammateId
        ? [
            {
              id: conversation.id,
              teammateId: conversation.teammateId,
              title: conversation.title,
              updatedAt: conversation.updatedAt,
              metadata: conversation.metadata,
            },
          ]
        : []
    ),
    hidden: visibleTeammates(teammates, viewer).filter((teammate) =>
        hidden.has(teammate.id)
      ),
    channels: channels.map((summary) => ({
        id: summary.channel.id,
        name: summary.channel.name,
        memberCount: summary.memberIds.length,
        teammateCount: summary.teammateIds.length,
        // Everybody in the room, Teammates first and then people, because the
        // row draws at most two and the agents are what a group on this page
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
            return teammate ? [{ id, seed: teammateAvatarSeed(teammate) }] : [];
          }),
          ...summary.memberIds.map((id) => ({ id, seed: id })),
        ].slice(0, 2),
        unread: summary.unread,
        lastMessagePreview: summary.lastMessagePreview,
      })),
    members: members
        .filter((member) => member.userId !== session.userId)
        .map((member) => ({
          userId: member.userId,
          label: memberDisplayName(member),
        })),
    collections: collections.map((c) => ({ id: c.id, name: c.name })),
    sources: libraryItems.sources,
    sourcesTruncated: libraryItems.truncated,
    projects: projects
        // Archived projects keep their decisions and stop feeding them to a
        // model, so attaching to one would be attaching to nothing.
        .filter((project) => !project.archived)
        .map((project) => ({ id: project.id, name: project.name })),
    canEdit: canEdit(role),
  };
}
