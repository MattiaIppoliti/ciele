import { redirect } from "next/navigation";
import { capabilitiesAllow } from "@agent-hub/core";
import { listRolesOp } from "@ciele/ops";
import { RoleEditorClient } from "@/components/settings/role-editor-client";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { requirePageMember } from "@/lib/authz";
import { runPageOperation } from "@/lib/operations";

export const dynamic = "force-dynamic";

export default async function NewRolePage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { capabilities, role } = await requirePageMember();
  if (!capabilitiesAllow(capabilities, "roles:manage")) redirect("/settings/roles");
  const [{ from }, roles] = await Promise.all([searchParams, runPageOperation(listRolesOp, {})]);

  return (
    <SettingsPanel title="New role" description="Start from an existing role or from nothing, then choose what it can do.">
      <RoleEditorClient
        mode="create"
        roles={roles}
        startFromId={roles.some((item) => item.id === from) ? from! : null}
        callerCapabilities={capabilities}
        callerIsOwner={role === "owner"}
        canManage
        holdsRole={false}
      />
    </SettingsPanel>
  );
}
