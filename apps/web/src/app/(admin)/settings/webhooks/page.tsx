import { redirect } from "next/navigation";
import { listOutboundWebhooksOp } from "@ciele/ops";
import { WebhooksClient } from "@/components/settings/webhooks-client";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";
import { requirePageMember } from "@/lib/authz";
import { runOperation } from "@/lib/operations";
import { can } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export default async function WebhooksSettingsPage() {
  const { role, capabilities } = await requirePageMember();
  const access = { role, capabilities };
  if (!can(access, "webhooks:manage")) redirect("/settings/profile");
  const result = await runOperation(listOutboundWebhooksOp, {});
  return <SettingsPanel title="Webhooks" description="Send signed Organization events to your systems.">
    <SectionTimeline><TimelineSection title="Subscriptions"><WebhooksClient subscriptions={result.items} available={result.available} /></TimelineSection></SectionTimeline>
  </SettingsPanel>;
}
