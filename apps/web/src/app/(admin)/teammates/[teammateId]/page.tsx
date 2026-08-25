import { notFound } from "next/navigation";
import { canEditTeammate, isTeammateRetired } from "@agent-hub/core";
import { TeammateWorkspace } from "@/components/teammates/teammate-workspace";
import { requirePageMember } from "@/lib/authz";
import { canManageMembers } from "@/lib/rbac";
import { findVisibleTeammate } from "@/lib/teammates/access";

export const dynamic = "force-dynamic";

/**
 * One Teammate: the chat, with its configuration in a right-side drawer.
 *
 * A retired Teammate still opens. It answers nothing more, but the
 * Conversations a Member had with it are readable only here, so a 404 would
 * delete the history that the soft delete exists to keep (#767, story 33).
 */
export default async function TeammatePage({
  params,
  searchParams,
}: {
  params: Promise<{ teammateId: string }>;
  /**
   * `?c=` opens one past Conversation directly. Accepting a referral (#773)
   * navigates here with it, and that link is the whole handoff: without it the
   * Member lands on an empty chat and the summary the referring Teammate wrote
   * sits unread in a conversation they would have to hunt for in the history.
   */
  searchParams: Promise<{ c?: string }>;
}) {
  const { teammateId } = await params;
  const { c: initialConversationId } = await searchParams;
  const { organizationId, role, session, db } = await requirePageMember();

  const viewer = { userId: session.userId, role: role ?? "viewer" };
  const teammate = await findVisibleTeammate(
    db,
    organizationId,
    teammateId,
    viewer
  );
  if (!teammate) notFound();

  const [collections, members, thread, grants, learnings, projects, routines] =
    await Promise.all([
    db.listOrgCollections(organizationId),
    db.listMembers(organizationId),
    db.listTeammateConversations(teammate.id, session.userId),
    // What it may do (#770). Read for everyone who can open the page, because
    // an agent's capabilities are not a secret from the colleagues it works
    // with; only changing them is admin work.
    db.table("teammateGrants").list({ teammateId: teammate.id }),
    // Its Agent memory layer and the Projects it could attach to (#771).
    db.getMemoryDocument(organizationId, {
      scope: "agent",
      teammateId: teammate.id,
    }),
    db.table("projects").list({ organizationId }),
    db.table("teammateRoutines").list({ teammateId: teammate.id }),
  ]);

  return (
    <TeammateWorkspace
      teammate={teammate}
      collections={collections.map((c) => ({ id: c.id, name: c.name }))}
      members={members
        .filter((member) => member.userId !== teammate.ownerId)
        .map((member) => ({
          userId: member.userId,
          label:
            [member.firstName, member.lastName].filter(Boolean).join(" ") ||
            member.username ||
            member.email,
          // A Viewer named here would still be refused by `canEditTeammate`:
          // the org Role is the ceiling, so the picker says so up front.
          canEdit: member.role !== "viewer",
        }))}
      thread={thread.map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        // Carries the Routine marker so the list can label unattended runs.
        metadata: c.metadata,
      }))}
      canEdit={canEditTeammate(teammate, viewer)}
      governance={{
        domains: grants.map((grant) => grant.domain),
        ceiling: teammate.capabilityCeiling,
        approvalBypass: teammate.approvalBypass,
      }}
      canGrant={canManageMembers(role)}
      learnings={learnings?.body ?? ""}
      routines={routines}
      projects={projects
        // Archived projects keep their decisions and stop feeding them to a
        // model, so attaching to one would be attaching to nothing.
        .filter((project) => !project.archived)
        .map((project) => ({ id: project.id, name: project.name }))}
      retired={isTeammateRetired(teammate)}
      initialConversationId={initialConversationId ?? null}
    />
  );
}
