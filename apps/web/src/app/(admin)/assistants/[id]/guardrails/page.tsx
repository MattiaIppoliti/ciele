import { notFound } from "next/navigation";
import { GuardrailsClient } from "@/components/assistant/guardrails-client";
import { SectionHeading } from "@/components/ui/section-heading";
import { requirePageMember, requireAssistantPageAccess } from "@/lib/authz";
import { can } from "@/lib/rbac";
import { getAssistantCached } from "../get-assistant";

export default async function GuardrailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, organizationId } = await requirePageMember();
  const { access } = await requireAssistantPageAccess(id);
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();
  // Moderation runs on the Organization's OpenAI connection; the form warns
  // when there is none rather than letting a check fail silently in traffic.
  const connections = await db.listProviderConnections(organizationId);

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 @xl:px-8 @xl:py-10">
      <SectionHeading
        title="Guardrails"

      />
      <GuardrailsClient
        assistantId={id}
        initial={assistant.guardrails ?? []}
        canEdit={can(access, "assistants:edit")}
        hasOpenAiConnection={connections.some((c) => c.provider === "openai")}
      />
    </div>
  );
}
