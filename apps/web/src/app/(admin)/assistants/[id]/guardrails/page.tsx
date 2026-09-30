import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { GuardrailsClient } from "@/components/assistant/guardrails-client";
import { SectionHeading } from "@/components/ui/section-heading";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";
import { getAssistantCached } from "../get-assistant";

export default async function GuardrailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role, db, organizationId } = await requirePageMember();
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();
  // Moderation runs on the Organization's OpenAI connection; the form warns
  // when there is none rather than letting a check fail silently in traffic.
  const connections = await db.listProviderConnections(organizationId);

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 @xl:px-8 @xl:py-10">
      <SectionHeading
        icon={ShieldCheck}
        title="Guardrails"
        description="Checks on what visitors send and what the answer shows."
      />
      <GuardrailsClient
        assistantId={id}
        initial={assistant.guardrails ?? []}
        canEdit={canEdit(role)}
        hasOpenAiConnection={connections.some((c) => c.provider === "openai")}
      />
    </div>
  );
}
