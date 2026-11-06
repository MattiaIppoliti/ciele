import { notFound } from "next/navigation";
import { AssistantHelpDesks } from "@/components/assistant/assistant-help-desks";
import { SectionHeading } from "@/components/ui/section-heading";
import { requirePageMember, requireAssistantPageAccess } from "@/lib/authz";
import { can } from "@/lib/rbac";
import { getAssistantCached } from "../get-assistant";

export default async function HelpDesksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await requirePageMember();
  const { access } = await requireAssistantPageAccess(id);
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();
  const desks = await db.listHelpDesks(assistant.organizationId);

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 @xl:px-8 @xl:py-10">
      <SectionHeading
        title="Help desks"

      />
      <AssistantHelpDesks
        assistantId={id}
        settings={assistant.helpDeskSettings}
        desks={desks}
        canEdit={can(access, "assistants:edit")}
      />
    </div>
  );
}
