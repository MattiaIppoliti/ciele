import { CostDashboard } from "@/components/insights/dashboard/cost-dashboard";
import { loadDashboardPage } from "@/lib/insights/dashboard";

export const dynamic = "force-dynamic";

export default async function InsightsCostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <CostDashboard {...await loadDashboardPage(searchParams)} />;
}
