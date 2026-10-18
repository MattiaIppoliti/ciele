import { NextRequest } from "next/server";
import { createDb, isSupabaseConfigured } from "@agent-hub/db";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";
import {
  createSupabaseRlsClient,
  getSupabaseSessionRlsContext,
} from "@/lib/supabase/server";
import {
  dashboardFilterFromSearchParams,
  dashboardWindow,
} from "@/lib/insights/dashboard-filter";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.organization)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const context = isSupabaseConfigured()
    ? await getSupabaseSessionRlsContext()
    : null;
  if (isSupabaseConfigured() && !context)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = context
    ? createDb(createSupabaseRlsClient(context.accessToken))
    : await getDb();
  const filter = dashboardFilterFromSearchParams(request.nextUrl.searchParams),
    window = dashboardWindow(filter);
  try {
    const [assistants, facts] = await Promise.all([
      db.listPublishedAvailabilityTargets(session.organization.id),
      db.getAssistantAvailability(
        session.organization.id,
        window.from,
        window.to,
      ),
    ]);
    return Response.json(
      { assistants, facts },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (!["PGRST202", "42P01", "42883", "PGRST205"].includes(code ?? ""))
      throw error;
    return Response.json(
      { error: "Availability monitoring is awaiting its database migration." },
      { status: 503 },
    );
  }
}
