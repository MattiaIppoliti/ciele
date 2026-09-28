import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import {
  dashboardFilterFromSearchParams,
  getUsageDashboardCached,
} from "@/lib/insights/dashboard";

/**
 * Browser adapter for the Dashboard tab's read. The session check is the
 * authorization; the read is the shared five-minute per-(Organization, filter)
 * cache, expired by the same `DELETE /api/insights` as the overview.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.organization) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const view = await getUsageDashboardCached(
    session.organization.id,
    dashboardFilterFromSearchParams(request.nextUrl.searchParams)
  );
  return Response.json(view, { headers: { "Cache-Control": "private, no-store" } });
}
