import { listQuickTextsOp } from "@ciele/ops";
import { QuickTextsClient } from "@/components/settings/quick-texts-client";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";
import { requirePageMember } from "@/lib/authz";
import { runOperation } from "@/lib/operations";
import { can } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function QuickTextsSettingsPage() {
  const { role, capabilities } = await requirePageMember();
  const access = { role, capabilities };
  // One migration behind (#1085 not applied yet): an empty list, not an error.
  const quickTexts = await runOperation(listQuickTextsOp, {}).catch(() => []);

  return (
    <SettingsPanel
      title="Quick Texts"
      description="Saved replies for the Inbox. Type / in the reply box to insert one. Template variables such as {{user.name}} are filled in from the conversation you answer."
    >
      <SectionTimeline><TimelineSection title="Saved replies"><QuickTextsClient quickTexts={quickTexts} canEdit={can(access, "quickTexts:edit")} /></TimelineSection></SectionTimeline>
    </SettingsPanel>
  );
}
