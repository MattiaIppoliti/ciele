import { Palette } from "lucide-react";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { ThemeSettingsClient } from "@/components/settings/theme-settings-client";

export default function ThemeSettingsPage() {
  return (
    <SettingsPanel
      icon={Palette}
      title="Theme"

    >
      <ThemeSettingsClient />
    </SettingsPanel>
  );
}
