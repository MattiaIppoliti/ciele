import { DataAssistantClient } from "@/components/data-assistant/data-assistant-client";
import { requirePageMember } from "@/lib/authz";
import { canManageMembers } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/**
 * Org-staff data assistant (#668): a chat surface over the Organization's
 * imported Records. Any signed-in Member (Viewer and up) may ask; admins
 * choose org-level which Entities it may query. Conversations run with the
 * member subject type and stay out of customer-facing Insights aggregates
 * and default Inbox views.
 */
export default async function DataAssistantPage() {
  const { organizationId, role, db } = await requirePageMember();

  const [entities, selectedIds, assistants] = await Promise.all([
    db.table("entities").list({ organizationId }),
    db.getDataAssistantEntityIds(organizationId),
    db.listAssistants(organizationId),
  ]);

  return (
    <DataAssistantClient
      entities={entities.map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
        scope: e.scope,
      }))}
      selectedIds={selectedIds}
      canManage={canManageMembers(role)}
      hasAssistant={assistants.length > 0}
    />
  );
}
