import { notFound } from "next/navigation";
import { getEnterpriseCapabilities } from "@agent-hub/agent";
import { requirePageMember } from "@/lib/authz";
import { dashboardFilterFromSearchParams } from "@/lib/insights/dashboard-filter";
import { PlatformInsightsDashboard } from "@/components/insights/platform-insights-dashboard";

export const dynamic = "force-dynamic";

export default async function InsightsAdminPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, organizationId } = await requirePageMember();
  const { from, to } = dashboardFilterFromSearchParams(await searchParams);
  const report = await getEnterpriseCapabilities().platformAdmin.getReport(
    { organizationId, userId: session.userId }, { from, to },
  );
  if (!report) notFound();
  return <PlatformInsightsDashboard report={report} />;
}
