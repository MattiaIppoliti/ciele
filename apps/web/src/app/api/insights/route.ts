import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getInsightsOverviewCached,
  insightsFilterFromSearchParams,
} from "@/lib/insights/report";

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
