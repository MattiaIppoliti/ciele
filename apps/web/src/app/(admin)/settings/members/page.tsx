import { redirect } from "next/navigation";
import { MembersClient } from "@/components/settings/members-client";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { capabilitiesAllow } from "@agent-hub/core";
import { requirePageMember } from "@/lib/authz";
import { roleChoices } from "@/lib/member-rows";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const { session, organizationId, role, capabilities, db } = await requirePageMember();
  if (!capabilitiesAllow(capabilities, "members:view")) redirect("/settings/profile");

  // Invites are for whoever manages Members (RLS enforces it too).
  const canManage = capabilitiesAllow(capabilities, "members:manage");
  const [members, invites, assistants, roles] = await Promise.all([
    db.listMembers(organizationId),
    canManage ? db.listInvites(organizationId) : Promise.resolve([]),
    canManage ? db.listAssistants(organizationId) : Promise.resolve([]),
    db.listOrgRoles(organizationId),
  ]);
  // Each Member's override rows, for the Assistants column. Admins only, like
  // the rows themselves (20260716120000's read policy).
  const accessRows = canManage
    ? await Promise.all(members.map((member) => db.listMemberAssistantAccess(organizationId, member.userId)))
    : [];

  return (
    <SettingsPanel
      title="Members"

    >
      <MembersClient
        members={members}
        invites={invites}
        currentUserId={session.userId}
        canManageRoles={canManage}
        canManageOwners={role === "owner"}
        roles={roleChoices(roles)}
        capabilities={capabilities}
        canInvite={canManage}
        demo={session.demo}
        assistantAccess={
          canManage
            ? {
                assistants: assistants.map((assistant) => ({ id: assistant.id, title: assistant.title })),
                members: Object.fromEntries(
                  members.map((member, index) => [
                    member.userId,
                    { scope: member.assistantScope ?? "all", rows: accessRows[index]?.length ?? 0 },
                  ])
                ),
              }
            : undefined
        }
      />
    </SettingsPanel>
  );
}
