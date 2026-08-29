import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InsightsFilter, InsightsOverview } from "@agent-hub/core";
import { isoDay } from "@agent-hub/core";
import { createDb, isSupabaseConfigured } from "@agent-hub/db";

import { getDb } from "@/lib/data";
import { getWidgetDb } from "@/lib/widget-db";

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
 * The dashboard's read: the same overview, cached for five minutes per
 * (Organization, filter) key.
 *
 * The uncached read runs the 30-day aggregate on every visit, which is an
 * analytical scan inside the OLTP database that grows with the tenant. The
 * KPIs are Organization-scoped, every Member of an Organization sees the same
 * numbers, so the cache key needs no user in it. What it must NOT contain is
 * the caller's RLS-scoped client: `getDb()` reads the request's cookies, and
 * a cookie-scoped read inside `unstable_cache` is both forbidden by Next and
 * a cross-user leak. The cached compute therefore runs on the service-role
 * client, and the CALLER is responsible for having authorized the
 * organizationId first (the pages do, through `requirePageMember`, and the
 * API route through its own guard).
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
  return unstable_cache(
    () => getWidgetDb().getInsightsOverview(organizationId, filters),
    ["insights-overview", organizationId, JSON.stringify(filters)],
    { revalidate: 300, tags: [`insights:${organizationId}`] }
  )();
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
