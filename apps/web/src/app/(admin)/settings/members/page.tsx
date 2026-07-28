import { redirect } from "next/navigation";
import { MembersClient } from "@/components/settings/members-client";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { requirePageMember } from "@/lib/authz";
import { canChangeRoles, canManageMembers, canViewMembers } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const { session, organizationId, role, db } = await requirePageMember();
  if (!canViewMembers(role)) redirect("/settings/profile");

  // Invites are admin-only (RLS enforces it too) — skip the fetch for editors.
  const canManage = canManageMembers(role);
  const [members, invites] = await Promise.all([
    db.listMembers(organizationId),
    canManage ? db.listInvites(organizationId) : Promise.resolve([]),
  ]);

  return (
    <SettingsPanel
      title="Members"
      description={`People in ${session.organization.name} and their roles.`}
    >
      <MembersClient
        members={members}
        invites={invites}
        currentUserId={session.userId}
        canChangeRoles={canChangeRoles(role)}
        canInvite={canManage}
        demo={session.demo}
      />
    </SettingsPanel>
  );
}
