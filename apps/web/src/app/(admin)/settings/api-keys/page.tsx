import { redirect } from "next/navigation";
import { ApiKeysClient } from "@/components/settings/api-keys-client";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { capabilitiesAllow } from "@agent-hub/core";
import { requirePageMember } from "@/lib/authz";
import { roleChoices } from "@/lib/member-rows";
import { docsOrigin } from "@/lib/origins";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const { session, organizationId, role, capabilities, db } = await requirePageMember();
  if (!capabilitiesAllow(capabilities, "apiKeys:manage")) redirect("/settings/profile");

  const [keys, roles] = await Promise.all([db.listApiKeys(organizationId), db.listOrgRoles(organizationId)]);

  return (
    <SettingsPanel
      title="API Keys"
      description="Keys act with their assigned role, up to your own."
    >
      <ApiKeysClient
        keys={keys}
        roles={roleChoices(roles)}
        capabilities={capabilities}
        isOwner={role === "owner"}
        demo={session.demo}
        apiDocumentationUrl={`${docsOrigin()}/api-reference`}
      />
    </SettingsPanel>
  );
}
