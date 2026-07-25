import { notFound } from "next/navigation";
import { AssistantHelpDesks } from "@/components/assistant/assistant-help-desks";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";
import { getAssistantCached } from "../get-assistant";

export default async function HelpDesksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role, db } = await requirePageMember();
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();
  const desks = await db.listHelpDesks(assistant.organizationId);

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <AssistantHelpDesks
        assistantId={id}
        settings={assistant.helpDeskSettings}
        desks={desks}
        canEdit={canEdit(role)}
      />
    </div>
  );
}
