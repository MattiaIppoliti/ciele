import { ProfileClient } from "@/components/settings/profile-client";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { requirePageMember } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { session } = await requirePageMember();

  return (
    <SettingsPanel
      title="Profile"
      description={`Your name, username, and photo, shown to the rest of ${session.organization.name}.`}
    >
      <ProfileClient
        email={session.email}
        profile={session.profile}
        demo={session.demo}
      />
    </SettingsPanel>
  );
}
