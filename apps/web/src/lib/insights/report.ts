import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InsightsFilter, InsightsOverview } from "@agent-hub/core";
import { createDb, isSupabaseConfigured } from "@agent-hub/db";

import { getDb } from "@/lib/data";
import { dayRangeFromSearchParams } from "@/lib/day-range";
import { filtersFromSearchParams } from "@/lib/url-state";
import {
  createSupabaseRlsClient,
  getSupabaseSessionRlsContext,
} from "@/lib/supabase/server";
import { insightsOrganizationTag } from "@/lib/insights/cache";
import { DEFAULT_RANGE_DAYS, lastDaysRange } from "@/lib/insights/range";

export type {
  InsightsAggregate,
  InsightsFilter,
  InsightsOverview,
} from "@agent-hub/core";

/**
 * Insights read module (apps/web façade): the aggregation lives in the Db
 * seam, a security-invoker SQL function in production, the in-memory oracle
 * in demo mode, so the browser only ever receives bounded metrics.
 *
 * A `client` may be passed for callers without a request session, the export
 * worker runs under the service role and supplies its own client so the same
 * reporting seam produces both the dashboard and the async artifact.
 */
export async function getInsightsOverview(
  organizationId: string,
  filters: InsightsFilter,
  client?: SupabaseClient
) {
  const db = client ? createDb(client) : await getDb();
  return db.getInsightsOverview(organizationId, filters);
}

/**
 * The cached reader resolves every request-specific value before entering
 * `unstable_cache`; no cookie store or request-bound client is captured. A
 * miss runs as the Member, through a client carrying the Member's access
 * token, so Postgres RLS still guards the aggregate.
 *
 * The key is (Organization, filters) and deliberately not the Member. The
 * read policies are Organization-wide: `assistants` and the tables under it
 * use `is_org_member(organization_id)` (0003_multi_tenant.sql, "members read"
 * policies), and `conversations` is readable by any member of the owning
 * Assistant's Organization (0004_runtime.sql, "members read own
 * conversations"). Every Member therefore computes identical numbers, and a
 * per-Member key would only multiply the cold 30-day scan by the roster size.
 * The token stays an execution credential: it never enters the key or a tag.
 */
function getCachedRlsInsightsOverview(
  accessToken: string,
  organizationId: string,
  filtersJson: string,
) {
  return unstable_cache(
    async () => {
      const db = createDb(createSupabaseRlsClient(accessToken));
      return db.getInsightsOverview(
        organizationId,
        JSON.parse(filtersJson) as InsightsFilter,
      );
    },
    ["insights-overview-rls-v5", organizationId, filtersJson],
    {
      revalidate: 300,
      tags: [insightsOrganizationTag(organizationId)],
    },
  )();
}

/**
 * The dashboard's read: the same overview, cached for five minutes per
 * (Organization, filter) key and tagged `insights:{organizationId}`, which
 * `revalidateEntities` expires whenever a mutation touches what the aggregate
 * counts (ADR-0005 as amended).
 *
 * The uncached read runs the 30-day aggregate on every visit, which is an
 * analytical scan inside the OLTP database that grows with the tenant. The
 * caller authorizes organizationId first (the page through requirePageMember,
 * the API route through getSession); the cached read then proves that access
 * again at the database boundary with the caller's access token.
 *
 * Freshness rule, stated: a dashboard number may be up to five minutes old.
 * Demo/mock mode bypasses the cache, the offline suite relies on
 * deterministic in-memory reads.
 */
export async function getInsightsOverviewCached(
  organizationId: string,
  filters: InsightsFilter
): Promise<InsightsOverview> {
  if (!isSupabaseConfigured()) {
    return getInsightsOverview(organizationId, filters);
  }
  const rlsContext = await getSupabaseSessionRlsContext();
  if (!rlsContext) throw new Error("Authenticated session required");
  return getCachedRlsInsightsOverview(
    rlsContext.accessToken,
    organizationId,
    JSON.stringify(filters),
  );
}

/**
 * The "Last 30 Days" preset exactly, in UTC days, so the browser derives the
 * same range and a fresh visit reads as the preset rather than as 31 custom
 * days.
 */
export function defaultInsightsFilter(now = new Date()): InsightsFilter {
  return {
    ...lastDaysRange(DEFAULT_RANGE_DAYS, now),
    aggregate: "daily",
    assistantId: "",
    channel: "",
    role: "",
    feedback: "",
    escalation: "",
  };
}

/** The typed filters' legal values, so a hand-edited link cannot widen them. */
const INSIGHTS_FILTER_OPTIONS = {
  aggregate: ["daily", "weekly", "monthly"],
  feedback: ["", "up", "down"],
  escalation: ["", "escalated", "not_escalated"],
} as const;

/**
 * The Insights view a URL asks for: the overview, its Exports and the export
 * worker all read their filter here. The day range goes through the shared
 * reader, so an impossible or inverted range never reaches the aggregate.
 */
export function insightsFilterFromSearchParams(
  params: URLSearchParams
): InsightsFilter {
  const fallback = defaultInsightsFilter();
  return {
    ...filtersFromSearchParams(params, fallback, INSIGHTS_FILTER_OPTIONS),
    ...dayRangeFromSearchParams(params, fallback),
  };
}
