import { notFound } from "next/navigation";
import { ToolsClient } from "@/components/assistant/tools-client";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";
import { getAssistantCached } from "../get-assistant";

export default async function ToolsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role, db } = await requirePageMember();
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();
  const [skills, attachedSkills, orgEntities, integration] = await Promise.all([
    db.listSkills(assistant.organizationId),
    db.listAssistantSkills(id),
    db.table("entities").list({ organizationId: assistant.organizationId }),
    db.getApiIntegration(id),
  ]);
  // Shared and user-scoped Entities are both selectable (#665, #667); the
  // runtime's registration policy decides which tool variants a turn gets.
  const entities = orgEntities;

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8 sm:py-8">
      <h1 className="text-2xl font-semibold">Tools &amp; Skills</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        The agent&apos;s tool registry and reusable prompt skills, what it can
        do while answering, beyond generating text.
      </p>
      <ToolsClient
        assistantId={id}
        tools={assistant.tools}
        skills={skills}
        attachedSkillIds={attachedSkills.map((skill) => skill.id)}
        entities={entities}
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
