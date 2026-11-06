import { redirect } from "next/navigation";
import { listBusinessHoursOp } from "@ciele/ops";
import { BusinessHoursClient } from "@/components/settings/business-hours-client";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";
import { requirePageMember } from "@/lib/authz";
import { runOperation } from "@/lib/operations";
import { can } from "@/lib/rbac";
export const dynamic = "force-dynamic";
export default async function BusinessHoursPage() {
  const { role, capabilities } = await requirePageMember();
  const access = { role, capabilities };
  if (!can(access, "businessHours:edit")) redirect("/settings/profile");
  const settings = await runOperation(listBusinessHoursOp, {});
  return <SettingsPanel title="Business hours" description="Share opening hours and holidays across channels and Flows."><SectionTimeline><TimelineSection title="Schedules"><BusinessHoursClient {...settings} /></TimelineSection></SectionTimeline></SettingsPanel>;
}
