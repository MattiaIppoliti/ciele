import { redirect } from "next/navigation";
import { OrganizationClient } from "@/components/settings/organization-client";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { requirePageMember } from "@/lib/authz";
import { canManageMembers } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/** The dialog's first tab: the Organization profile (name + logo). */
export default async function GeneralSettingsPage() {
  const { session, role } = await requirePageMember();
  if (!canManageMembers(role)) redirect("/settings/profile");

  return (
    <SettingsPanel
      title="General"
      description={`Name and logo shown across ${session.organization.name}'s workspace.`}
    >
      <OrganizationClient
        organization={session.organization}
        demo={session.demo}
      />
    </SettingsPanel>
  );
}
