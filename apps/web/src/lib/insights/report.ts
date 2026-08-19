import type { SupabaseClient } from "@supabase/supabase-js";
import type { InsightsFilter } from "@agent-hub/core";
import { isoDay } from "@agent-hub/core";
import { createDb } from "@agent-hub/db";

import { getDb } from "@/lib/data";

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
