import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InsightsFilter, InsightsOverview } from "@agent-hub/core";
import { isoDay } from "@agent-hub/core";
import { createDb, isSupabaseConfigured } from "@agent-hub/db";

import { getDb } from "@/lib/data";
import {
  createSupabaseRlsClient,
  getSupabaseSessionRlsContext,
} from "@/lib/supabase/server";
import { insightsOrganizationTag } from "@/lib/insights/cache";

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

export function defaultInsightsFilter(now = new Date()): InsightsFilter {
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    from: isoDay(from),
    to: isoDay(now),
    aggregate: "daily",
    assistantId: "",
    channel: "",
    role: "",
    feedback: "",
    escalation: "",
  };
}

export function insightsFilterFromSearchParams(
  params: URLSearchParams
): InsightsFilter {
  const fallback = defaultInsightsFilter();
  const aggregate = params.get("aggregate");
  const feedback = params.get("feedback");
  const escalation = params.get("escalation");
  const from = params.get("from");
  const to = params.get("to");
  const validDate = (value: string | null): value is string =>
    value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value);
  return {
    from: validDate(from) ? from : fallback.from,
    to: validDate(to) ? to : fallback.to,
    aggregate:
      aggregate === "weekly" || aggregate === "monthly" ? aggregate : "daily",
    assistantId: params.get("assistantId") || "",
    channel: params.get("channel") || "",
    role: params.get("role") || "",
    feedback: feedback === "up" || feedback === "down" ? feedback : "",
    escalation:
      escalation === "escalated" || escalation === "not_escalated"
        ? escalation
        : "",
  };
}
