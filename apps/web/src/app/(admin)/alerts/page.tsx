import { AlertsList } from "@/components/alerts/alerts-list";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const { organizationId, role, db } = await requirePageMember();

  const alerts = await db.listAlerts(organizationId);

  return <AlertsList alerts={alerts} canEdit={canEdit(role)} />;
}
