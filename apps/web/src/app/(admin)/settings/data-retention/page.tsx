import { redirect } from "next/navigation";
import { DataRetentionClient } from "@/components/settings/data-retention-client";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { requirePageMember } from "@/lib/authz";
import { can } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/** How long each type of data is kept, and whether it is deleted when it expires. */
export default async function DataRetentionPage() {
  const { session, role, capabilities } = await requirePageMember();
  const access = { role, capabilities };
  if (!can(access, "organization:edit")) redirect("/settings/profile");

  return (
    <SettingsPanel
      title="Data retention"
      description="Set how long each type of data is kept, and whether it is deleted when it expires."
    >
      <DataRetentionClient organization={session.organization} demo={session.demo} />
    </SettingsPanel>
  );
}
