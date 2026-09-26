import { withCronAuth } from "@/lib/cron-auth";
import { getWidgetDb } from "@/lib/widget-db";
import { enqueueVerbatimReingests } from "@agent-hub/agent";

/**
 * The one-off verbatim re-ingest (ADR-0025), the HTTP adapter.
 *
 * Deliberately **not scheduled**: it is in neither vercel.json nor the
 * self-host crontab. An operator calls it by hand, with the cron secret,
 * passing each response's `next` back as `after` until `next` comes back null:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://ciele.app/api/cron/reingest-verbatim?limit=25&after=<next>"
 *
 * Each call rebuilds at most `limit` (1 to 100, default 25) Sources from their
 * own "Source Text" Concepts through the ordinary ingest job; the regular
 * `finalize-crawls` drain runs the jobs. What it does is `enqueueVerbatimReingests`
 * in `@agent-hub/agent`, where it is tested without a request.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withCronAuth(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const raw = Number(params.get("limit") ?? 25);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 25;
  const after = params.get("after") || undefined;
  return Response.json(await enqueueVerbatimReingests({ db: getWidgetDb() }, { limit, after }));
});
