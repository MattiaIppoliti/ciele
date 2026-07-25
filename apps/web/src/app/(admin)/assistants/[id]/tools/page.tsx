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
  const [skills, attachedSkills] = await Promise.all([
    db.listSkills(assistant.organizationId),
    db.listAssistantSkills(id),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <h1 className="text-2xl font-semibold">Tools &amp; Skills</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        The agent&apos;s tool registry and reusable prompt skills — what it can
        do while answering, beyond generating text.
      </p>
      <ToolsClient
        assistantId={id}
        tools={assistant.tools}
        skills={skills}
        attachedSkillIds={attachedSkills.map((skill) => skill.id)}
        canEdit={canEdit(role)}
      />
    </div>
  );
}
