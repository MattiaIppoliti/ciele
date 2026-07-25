import { AssistantsPageClient } from "@/components/assistants/assistants-page-client";
import { requirePageMember } from "@/lib/authz";
import { canEdit, canPublish } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function AssistantsPage() {
  const { role, reads } = await requirePageMember();

  const assistants = await reads.assistants();

  return (
    <AssistantsPageClient
      assistants={assistants}
      canCreate={canEdit(role)}
      canDelete={canPublish(role)}
    />
  );
}
