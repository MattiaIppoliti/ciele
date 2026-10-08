import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { AuthenticationClient } from "@/components/assistant/authentication-client";
import { SectionHeading } from "@/components/ui/section-heading";
import { requirePageMember } from "@/lib/authz";
import { canEdit, canManageMembers } from "@/lib/rbac";
import { getAssistantCached } from "../get-assistant";

export default async function AuthenticationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { role, db } = await requirePageMember();
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();
  // The browser only receives non-secret connection state.
  const connection = await db.getSsoConnection(assistant.organizationId);

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 @xl:px-8 @xl:py-10">
      <SectionHeading
        icon={Lock}
        title="Authentication"
        description="Shared across assistants."
      />
      <AuthenticationClient
        assistantId={id}
        requireSignIn={assistant.requireSignIn}
        connection={
          connection
            ? {
                provider: connection.provider,
                config: connection.config,
                validationStatus: connection.validationStatus,
              }
            : null
        }
        canManageConnection={canManageMembers(role)}
        canEdit={canEdit(role)}
      />
    </div>
  );
}
