import { notFound } from "next/navigation";
import { ToolsClient } from "@/components/assistant/tools-client";
import { SectionHeading } from "@/components/ui/section-heading";
import { requirePageMember, requireAssistantPageAccess } from "@/lib/authz";
import { can } from "@/lib/rbac";
import { getAssistantCached } from "../get-assistant";

export default async function ToolsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await requirePageMember();
  const { access } = await requireAssistantPageAccess(id);
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();
  const [skills, attachedSkills, integration, mcpServers] = await Promise.all([
    db.table("skills").list({ organizationId: assistant.organizationId }),
    db.listAssistantSkills(id),
    db.getApiIntegration(id),
    db.table("mcpServerConnections").list({ organizationId: assistant.organizationId }).catch(error => {
      if (error && typeof error === "object" && "code" in error && (error.code === "42P01" || error.code === "PGRST205")) return [];
      throw error;
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 @xl:px-8 @xl:py-10">
      <SectionHeading
        title="Tools & Skills"

      />
      <ToolsClient
        assistantId={id}
        mcpServers={mcpServers}
        tools={assistant.tools}
        skills={skills}
        attachedSkillIds={attachedSkills.map((skill) => skill.id)}
        // Everything but the credential: the sealed value never reaches the
        // browser, only whether one is set (spec #559).
        integration={
          integration
            ? {
                name: integration.name,
                baseUrl: integration.baseUrl,
                authType: integration.authType,
                authHeaderName: integration.authHeaderName,
                authUsername: integration.authUsername,
                hasCredential: integration.encryptedCredential !== null,
                endpoints: integration.endpoints,
              }
            : null
        }
        canEdit={can(access, "assistants:edit")}
      />
    </div>
  );
}
