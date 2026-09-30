"use client";

import { Building2 } from "lucide-react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { OrganizationClient } from "@/components/settings/organization-client";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { useSettingsSession } from "@/components/settings/settings-session";
import { PERSONAL_SETTINGS_HOME } from "@/components/settings/settings-nav";

/**
 * The dialog's first tab, rendered from the settings layout's session for the
 * same reason as the Profile tab. Someone who cannot manage the Organization is
 * sent to their own settings, as the server page used to do; what this tab
 * shows (the name and logo) is already on screen in the sidebar for every Role,
 * and saving it is authorized by the server action, not by this render.
 */
export default function GeneralSettingsPage() {
  const session = useSettingsSession();
  const router = useRouter();
  const allowed = session?.canManageOrg ?? false;
  useEffect(() => {
    if (session && !allowed) router.replace(PERSONAL_SETTINGS_HOME);
  }, [session, allowed, router]);
  if (!session || !allowed) return null;
  return (
    <SettingsPanel
      icon={Building2}
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
