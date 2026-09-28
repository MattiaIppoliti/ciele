import { AssistantsPageClient } from "@/components/assistants/assistants-page-client";
import { assistantsUrlStateFromSearchParams } from "@/components/assistants/assistants-url-state";
import { requirePageMember } from "@/lib/authz";
import { canEdit, canPublish } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function AssistantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { role, reads } = await requirePageMember();
  const initialUrlState = assistantsUrlStateFromSearchParams(await searchParams);

  const assistants = await reads.assistants();

  return (
    <AssistantsPageClient
      assistants={assistants}
      canCreate={canEdit(role)}
      canDelete={canPublish(role)}
      initialUrlState={initialUrlState}
    />
  );
}
