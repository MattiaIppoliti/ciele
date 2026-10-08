"use client";

import { Fingerprint } from "lucide-react";
import { ProfileClient } from "@/components/settings/profile-client";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { useSettingsSession } from "@/components/settings/settings-session";

/**
 * Renders from the settings layout's session instead of its own server read:
 * a route that reads nothing per request costs one round trip on a tab switch,
 * where the session read it replaces cost that plus the Organization and
 * profile queries behind it.
 */
export default function ProfilePage() {
  const session = useSettingsSession();
  if (!session) return null;
  return (
    <SettingsPanel
      icon={Fingerprint}
      title="Profile"

    >
      <ProfileClient
        email={session.email}
        profile={session.profile}
        demo={session.demo}
      />
    </SettingsPanel>
  );
}
