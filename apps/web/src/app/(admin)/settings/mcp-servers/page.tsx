import { redirect } from "next/navigation";
import { listMcpServersOp } from "@ciele/ops";
import { McpServersClient } from "@/components/settings/mcp-servers-client";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";
import { requirePageMember } from "@/lib/authz";
import { runOperation } from "@/lib/operations";
import { can } from "@/lib/rbac";
export const dynamic = "force-dynamic";
export default async function McpServersSettingsPage() {
  const { role, capabilities } = await requirePageMember();
  const access = { role, capabilities };
  if (!can(access, "mcpServers:manage")) redirect("/settings/profile");
  const result = await runOperation(listMcpServersOp, {});
  return <SettingsPanel title="MCP servers" description="Connect external tools and review what may run.">
    <SectionTimeline><TimelineSection title="Servers"><McpServersClient servers={result.items} available={result.available} /></TimelineSection></SectionTimeline>
  </SettingsPanel>;
}
