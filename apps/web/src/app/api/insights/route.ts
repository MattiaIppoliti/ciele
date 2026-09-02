import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getInsightsOverviewCached,
  insightsFilterFromSearchParams,
} from "@/lib/insights/report";
import { expireOrganizationInsights } from "@/lib/insights/cache";

/**
 * Browser adapter for the authenticated Insights read module. The session
 * check above the read is the authorization; the read itself is the shared
 * five-minute per-(Organization, filter) cache, so refiltering the dashboard
 * does not re-run the 30-day aggregate on every keystroke.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.organization) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const overview = await getInsightsOverviewCached(
    session.organization.id,
    insightsFilterFromSearchParams(request.nextUrl.searchParams)
  );
  return Response.json(overview, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

/**
 * Expire the Organization's cached overview so the next read recomputes it.
 * Same gate as GET, any signed-in Member of the Organization: the cache is
 * shared by the whole roster, and a Member can already force a miss by
 * changing a filter, so a narrower Role here would guard nothing. Used by the
 * latency probe (`scripts/check-admin-latency.mjs`) to measure a true cold
 * Insights load, and available to anyone who needs a number sooner than the
 * five-minute window. Documented on the Insights page of docs.ciele.app.
 */
export async function DELETE() {
  const session = await getSession();
  if (!session?.organization) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  expireOrganizationInsights(session.organization.id);
  return new Response(null, { status: 204 });
}
