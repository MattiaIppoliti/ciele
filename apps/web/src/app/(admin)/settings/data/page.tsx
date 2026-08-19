import { EntitiesClient } from "@/components/settings/entities-client";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/**
 * Org Data page (#663): Entities, typed schemas over structured business
 * data, and their CSV-imported Records. Every member can browse; editors and
 * up create, import, and delete (matching the table RLS).
 */
export default async function DataSettingsPage() {
  const { organizationId, role, db } = await requirePageMember();

  const entities = await db.table("entities").list({ organizationId });
  const counts = await Promise.all(
    entities.map((entity) => db.countEntityRecords(entity.id))
  );

  return (
    <EntitiesClient
      entities={entities.map((entity, i) => ({
        ...entity,
        recordCount: counts[i],
      }))}
      canEdit={canEdit(role)}
    />
  );
}
