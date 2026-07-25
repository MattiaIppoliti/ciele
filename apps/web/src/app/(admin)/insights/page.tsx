import { InsightsClient } from "@/components/insights/insights-client";
import { requirePageMember } from "@/lib/authz";
import { defaultInsightsFilter, getInsightsOverview } from "@/lib/insights/report";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const { organizationId, reads } = await requirePageMember();

  const filters = defaultInsightsFilter();
  const [overview, assistants] = await Promise.all([
    getInsightsOverview(organizationId, filters),
    reads.assistants(),
  ]);

  return (
    <InsightsClient
      initial={overview}
      initialFilters={filters}
      assistants={assistants.map((a) => ({ id: a.id, title: a.title }))}
    />
  );
}
