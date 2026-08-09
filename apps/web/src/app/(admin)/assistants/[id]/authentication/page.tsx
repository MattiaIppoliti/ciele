import { notFound } from "next/navigation";
import { AuthenticationClient } from "@/components/assistant/authentication-client";
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
    <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8 sm:py-8">
      <h1 className="text-2xl font-semibold">Authentication</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Require visitors to sign in with your identity provider before they can
        chat. The connection is shared across this organization&apos;s assistants;
        enforcement is per assistant.
      </p>
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
