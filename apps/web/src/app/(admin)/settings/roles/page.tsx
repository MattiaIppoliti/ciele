import { redirect } from "next/navigation";
import { CAPABILITIES, capabilitiesAllow } from "@agent-hub/core";
import { listRolesOp } from "@ciele/ops";
import { RolesListClient } from "@/components/settings/roles-list-client";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { requirePageMember } from "@/lib/authz";
import { runPageOperation } from "@/lib/operations";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const { capabilities, session } = await requirePageMember();
  if (!capabilitiesAllow(capabilities, "members:view")) redirect("/settings/profile");
  const roles = await runPageOperation(listRolesOp, {});

  return (
    <SettingsPanel
      title="Roles"
      description="A role is a set of capabilities. Give one to a member, an invitation or an API key."
    >
      <RolesListClient
        roles={roles}
        totalCapabilities={CAPABILITIES.length}
        canManage={capabilitiesAllow(capabilities, "roles:manage")}
        heldRoleId={session.roleId}
      />
    </SettingsPanel>
  );
}
