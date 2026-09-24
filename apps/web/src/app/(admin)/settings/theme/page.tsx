import { SettingsPanel } from "@/components/settings/settings-panel";
import { ThemeSettingsClient } from "@/components/settings/theme-settings-client";

export const dynamic = "force-dynamic";

export default function ThemeSettingsPage() {
  return (
    <SettingsPanel
      title="Theme"
      description="Set the appearance and colors for your Ciele workspace."
    >
      <ThemeSettingsClient />
    </SettingsPanel>
  );
}
