import { redirect } from "next/navigation";
import { capabilitiesAllow } from "@agent-hub/core";
import { getRoleOp, listRolesOp } from "@ciele/ops";
import { RoleEditorClient } from "@/components/settings/role-editor-client";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { requirePageMember } from "@/lib/authz";
import { runPageOperation } from "@/lib/operations";

export const dynamic = "force-dynamic";

export default async function RolePage({ params }: { params: Promise<{ roleId: string }> }) {
  const { capabilities, role, session } = await requirePageMember();
  if (!capabilitiesAllow(capabilities, "members:view")) redirect("/settings/profile");
  const { roleId } = await params;
  const [current, roles] = await Promise.all([
    runPageOperation(getRoleOp, { id: roleId }),
    runPageOperation(listRolesOp, {}),
  ]);

  return (
    <SettingsPanel title={current.name} description={current.description || undefined}>
      <RoleEditorClient
        mode="edit"
        role={current}
        roles={roles}
        startFromId={null}
        callerCapabilities={capabilities}
        callerIsOwner={role === "owner"}
        canManage={capabilitiesAllow(capabilities, "roles:manage")}
        holdsRole={session.roleId === current.id}
      />
    </SettingsPanel>
  );
}
