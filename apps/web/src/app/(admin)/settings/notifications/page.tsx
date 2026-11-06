import { getNotificationPreferencesOp } from "@ciele/ops";
import { NotificationPreferencesClient } from "@/components/settings/notification-preferences-client";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";
import { runPageOperation } from "@/lib/operations";

export const dynamic = "force-dynamic";

/**
 * Which Member Notifications also arrive by email (#1048, #1067). Personal:
 * the row is the Member's own, and every notification still lands on the
 * Notifications page whatever is chosen here.
 */
export default async function NotificationSettingsPage() {
  const preferences = await runPageOperation(getNotificationPreferencesOp, {});
  return (
    <SettingsPanel title="Notifications" description="Which notifications also arrive by email.">
      <SectionTimeline><TimelineSection title="Email"><NotificationPreferencesClient initial={preferences} /></TimelineSection></SectionTimeline>
    </SettingsPanel>
  );
}
