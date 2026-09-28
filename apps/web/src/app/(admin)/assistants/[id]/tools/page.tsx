import { notFound } from "next/navigation";
import { Wrench } from "lucide-react";
import { ToolsClient } from "@/components/assistant/tools-client";
import { SectionHeading } from "@/components/ui/section-heading";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";
import { getAssistantCached } from "../get-assistant";

export default async function ToolsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role, db } = await requirePageMember();
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();
  const [skills, attachedSkills, integration] = await Promise.all([
    db.table("skills").list({ organizationId: assistant.organizationId }),
    db.listAssistantSkills(id),
    db.getApiIntegration(id),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8 sm:py-10">
      <SectionHeading
        icon={Wrench}
        title="Tools & Skills"
        description="The agent's tool registry and reusable prompt skills, what it can do while answering, beyond generating text."
      />
      <ToolsClient
        assistantId={id}
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
        canEdit={canEdit(role)}
      />
    </div>
  );
}
