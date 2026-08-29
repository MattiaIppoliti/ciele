import { notFound } from "next/navigation";
import { canEditTeammate, isTeammateRetired } from "@agent-hub/core";
import { TeammateWorkspace } from "@/components/teammates/teammate-workspace";
import { requirePageMember } from "@/lib/authz";
import { canManageMembers } from "@/lib/rbac";
import { findVisibleTeammate } from "@/lib/teammates/access";
import { loadTeammateSettingsProps } from "@/lib/teammates/settings-props";

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

  const [settings, thread] = await Promise.all([
    // The same facts `/teammates/{id}/settings` renders, so the drawer and the
    // full-screen route configure the same Teammate.
    loadTeammateSettingsProps(db, organizationId, teammate),
    db.listTeammateConversations(teammate.id, session.userId),
  ]);

  return (
    <TeammateWorkspace
      teammate={teammate}
      {...settings}
      thread={thread.map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        // Carries the Routine marker so the list can label unattended runs.
        metadata: c.metadata,
      }))}
      canEdit={canEditTeammate(teammate, viewer)}
      canGrant={canManageMembers(role)}
      retired={isTeammateRetired(teammate)}
      initialConversationId={initialConversationId ?? null}
    />
  );
}
