import { KeyRound } from "lucide-react";
import { redirect } from "next/navigation";
import { ApiKeysClient } from "@/components/settings/api-keys-client";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { requirePageMember } from "@/lib/authz";
import { canManageApiKeys } from "@/lib/rbac";
import { docsOrigin } from "@/lib/origins";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const { session, organizationId, role, db } = await requirePageMember();
  if (!canManageApiKeys(role)) redirect("/settings/profile");

  const keys = await db.listApiKeys(organizationId);

  return (
    <SettingsPanel
      icon={KeyRound}
      title="API Keys"
      description="Keys act with their assigned role, up to your own."
    >
      <ApiKeysClient
        keys={keys}
        currentRole={role}
        demo={session.demo}
        apiDocumentationUrl={`${docsOrigin()}/api-reference`}
      />
    </SettingsPanel>
  );
}
