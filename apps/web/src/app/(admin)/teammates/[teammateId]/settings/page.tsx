import { notFound, redirect } from "next/navigation";
import { canEditTeammate } from "@agent-hub/core";
import { TeammateSettingsPage } from "@/components/teammates/teammate-settings-page";
import { requirePageMember } from "@/lib/authz";
import { canManageMembers } from "@/lib/rbac";
import { findVisibleTeammate } from "@/lib/teammates/access";
import { loadTeammateSettingsProps } from "@/lib/teammates/settings-props";

export const dynamic = "force-dynamic";

/**
 * One Teammate's configuration, full width: what the chat's drawer offers
 * behind "Open full screen", the way an Improvement's drawer hands off to
 * `/improvements/{id}`.
 *
 * A Member who cannot edit this Teammate is sent to its chat rather than shown
 * a form they may not save. The drawer never offers them the button either;
 * this is the same rule for anyone arriving by URL.
 */
export default async function TeammateSettingsRoute({
  params,
}: {
  params: Promise<{ teammateId: string }>;
}) {
  const { teammateId } = await params;
  const { organizationId, role, session, db } = await requirePageMember();

  const viewer = { userId: session.userId, role: role ?? "viewer" };
  const teammate = await findVisibleTeammate(
    db,
    organizationId,
    teammateId,
    viewer
  );
  if (!teammate) notFound();
  if (!canEditTeammate(teammate, viewer)) {
    redirect(`/teammates/${teammate.id}`);
  }

  const props = await loadTeammateSettingsProps(db, organizationId, teammate);

  return (
    <TeammateSettingsPage
      teammate={teammate}
      canGrant={canManageMembers(role)}
      {...props}
    />
  );
}
