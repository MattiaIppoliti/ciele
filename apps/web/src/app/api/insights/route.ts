import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getInsightsOverview,
  insightsFilterFromSearchParams,
} from "@/lib/insights/report";

/** Browser adapter for the authenticated, RLS-invoker Insights read module. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.organization) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const overview = await getInsightsOverview(
    session.organization.id,
    insightsFilterFromSearchParams(request.nextUrl.searchParams)
  );
  return Response.json(overview, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
