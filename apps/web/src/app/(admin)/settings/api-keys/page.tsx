import { redirect } from "next/navigation";
import { ApiKeysClient } from "@/components/settings/api-keys-client";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { requirePageMember } from "@/lib/authz";
import { canManageApiKeys } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const { session, organizationId, role, db } = await requirePageMember();
  if (!canManageApiKeys(role)) redirect("/settings/profile");

  const keys = await db.listApiKeys(organizationId);

  return (
    <SettingsPanel
      title="API Keys"
      description="Organization-scoped keys for the CLI, the MCP server and the API. A key acts with the role you give it, capped at your own."
    >
      <ApiKeysClient keys={keys} currentRole={role} demo={session.demo} />
    </SettingsPanel>
  );
}
