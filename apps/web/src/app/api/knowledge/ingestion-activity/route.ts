import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";
import {
  readIngestionActivity,
  TRACKED_ID_LIMIT,
} from "@/lib/ingestion-activity-read";

/**
 * What the bottom-right ingestion card polls while a crawl or an Application
 * Import is in flight (#Ciele UI: crawling status).
 *
 * Its own route rather than a server action because it is a read on a timer:
 * an action would revalidate the router cache on every tick and re-render the
 * page under the card. Only polled while the card believes something is
 * running, so an idle console makes no requests at all.
 *
 * `sources` and `imports` are the ids the card is already following, so their
 * outcome can be resolved after they leave the in-flight query. They narrow a
 * read that is org-scoped either way: the Db here is the caller's RLS-bound
 * client, so an id from another Organization resolves to nothing.
 */

export const dynamic = "force-dynamic";

function ids(request: NextRequest, key: string): string[] {
  return (request.nextUrl.searchParams.get(key) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, TRACKED_ID_LIMIT);
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.organization) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const snapshot = await readIngestionActivity(
    await getDb(),
    session.organization.id,
    { sources: ids(request, "sources"), imports: ids(request, "imports") },
  );

  return Response.json(snapshot, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
