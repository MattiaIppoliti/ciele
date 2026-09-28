import { ObservabilityDashboard } from "@/components/insights/dashboard/observability-dashboard";
import { loadDashboardPage } from "@/lib/insights/dashboard";

export const dynamic = "force-dynamic";

export default async function InsightsObservabilityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ObservabilityDashboard {...await loadDashboardPage(searchParams)} />;
}
