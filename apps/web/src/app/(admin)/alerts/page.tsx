import { AlertsList } from "@/components/alerts/alerts-list";
import { alertsUrlStateFromSearchParams } from "@/components/alerts/alerts-url-state";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId, role, db } = await requirePageMember();
  // Parsed here so a copied `?status=active` link renders on that tab first.
  const initialUrlState = alertsUrlStateFromSearchParams(await searchParams);

  const alerts = await db.listAlerts(organizationId);

  return (
    <AlertsList
      alerts={alerts}
      canEdit={canEdit(role)}
      initialUrlState={initialUrlState}
    />
  );
}
