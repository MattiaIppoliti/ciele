import { HelpDesksClient } from "@/components/help-desks/help-desks-client";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function HelpDesksPage() {
  const { organizationId, role, db } = await requirePageMember();

  const desks = await db.listHelpDesks(organizationId);

  return <HelpDesksClient desks={desks} canEdit={canEdit(role)} />;
}
