import { unstable_cache } from "next/cache";
import type { DashboardFacts, UsageDashboardFilter } from "@agent-hub/core";
import { computeUsageDashboard } from "@agent-hub/core";
import { createDb, isSupabaseConfigured, type Db } from "@agent-hub/db";

import { requirePageMember } from "@/lib/authz";
import { getDb } from "@/lib/data";
import { insightsOrganizationTag } from "@/lib/insights/cache";
import {
  dashboardFilterFromSearchParams,
  dashboardWindow,
  previousPeriodFilter,
  type DashboardView,
} from "@/lib/insights/dashboard-filter";
import {
  createSupabaseRlsClient,
  getSupabaseSessionRlsContext,
} from "@/lib/supabase/server";

export { dashboardFilterFromSearchParams };

const EMPTY_FACTS: DashboardFacts = { usage: [], turns: [], verdicts: [], conversations: [] };

/**
 * PostgREST's "no such function" (PGRST202) and Postgres's own (42883). The
 * app deploys minutes before the CI applier runs its migration, so for that
 * window the four `org_dashboard_*` functions do not exist yet. The page then
 * renders empty with a notice rather than failing the whole Insights section.
 */
function isMissingFunction(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "PGRST202" || code === "42883";
}

/**
 * One read covers this period and the one before it, so the stat cards'
 * deltas cost no second round trip. Both are pivoted from the same facts,
 * which is what makes "vs previous period" compare like with like.
 */
async function read(
  db: Db,
  organizationId: string,
  filter: UsageDashboardFilter
): Promise<DashboardView> {
  const before = previousPeriodFilter(filter);
  const window = { from: dashboardWindow(before).from, to: dashboardWindow(filter).to };
  try {
    const all = await db.getOrgDashboardFacts(organizationId, window.from, window.to);
    const previous = computeUsageDashboard(all, before).totals;
    const active = previous.calls > 0 || previous.turns > 0 || previous.conversations > 0;
    return {
      dashboard: computeUsageDashboard(all, filter),
      previous: active ? previous : null,
      unavailable: false,
    };
  } catch (error) {
    if (!isMissingFunction(error)) throw error;
    return { dashboard: computeUsageDashboard(EMPTY_FACTS, filter), previous: null, unavailable: true };
  }
}

/**
 * Cached per (Organization, filter) for five minutes under the Insights tag, the
 * same freshness rule and the same expiry as the overview on the Insights tab
 * (see `report.ts` for why the key names the Organization and not the Member).
 * The pivot runs inside the cache, so a hit returns the small computed shape
 * rather than re-summing the facts.
 */
function getCachedRlsDashboard(accessToken: string, organizationId: string, filterJson: string) {
  return unstable_cache(
    async () => {
      const filter = JSON.parse(filterJson) as UsageDashboardFilter;
      const db = createDb(createSupabaseRlsClient(accessToken));
      return read(db, organizationId, filter);
    },
    ["usage-dashboard-rls-v2", organizationId, filterJson],
    { revalidate: 300, tags: [insightsOrganizationTag(organizationId)] }
  )();
}

/**
 * The Dashboard tab's read. The caller authorizes `organizationId` first (the
 * page through requirePageMember, the API route through getSession); the
 * cached read proves it again at the database with the Member's token. Demo
 * mode bypasses the cache, like the overview does.
 */
export async function getUsageDashboardCached(
  organizationId: string,
  filter: UsageDashboardFilter
): Promise<DashboardView> {
  if (!isSupabaseConfigured()) {
    const db = await getDb();
    return read(db, organizationId, filter);
  }
  const rlsContext = await getSupabaseSessionRlsContext();
  if (!rlsContext) throw new Error("Authenticated session required");
  return getCachedRlsDashboard(rlsContext.accessToken, organizationId, JSON.stringify(filter));
}

/**
 * Everything the Costs and Observability pages hand their client component:
 * the same parser the /api/insights/dashboard route uses, so a shared link
 * opens on its range and filters and anything invalid falls back.
 */
export async function loadDashboardPage(
  searchParams: Promise<Record<string, string | string[] | undefined>>
) {
  const { organizationId, reads } = await requirePageMember();
  const filter = dashboardFilterFromSearchParams(await searchParams);
  const [view, assistants] = await Promise.all([
    getUsageDashboardCached(organizationId, filter),
    reads.assistants(),
  ]);
  return {
    initial: view,
    initialFilter: filter,
    assistants: assistants.map((a) => ({ id: a.id, title: a.title })),
  };
}
