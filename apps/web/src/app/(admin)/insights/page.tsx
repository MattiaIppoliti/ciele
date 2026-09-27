import { InsightsClient } from "@/components/insights/insights-client";
import { requirePageMember } from "@/lib/authz";
import {
  getInsightsOverviewCached,
  insightsFilterFromSearchParams,
} from "@/lib/insights/report";

export const dynamic = "force-dynamic";

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId, reads } = await requirePageMember();

  // The same parser the /api/insights route uses, so a shared link opens on
  // its range and filters, and anything invalid falls back to the defaults.
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) params.set(key, first);
  }
  const filters = insightsFilterFromSearchParams(params);
  const [overview, assistants] = await Promise.all([
    getInsightsOverviewCached(organizationId, filters),
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
