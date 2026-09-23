import { withCronAuth } from "@/lib/cron-auth";
import { getWidgetDb } from "@/lib/widget-db";
import { platformOwnerOrganizationIds } from "@/lib/platform";
import { runPreflightDriftReplay } from "@agent-hub/agent";

/**
 * The pre-flight's nightly drift replay (#953), the HTTP adapter.
 *
 * Cron auth in, the tick's report out. What a tick does is
 * `runPreflightDriftReplay` in `@agent-hub/agent`: the labelled messages the
 * decision model routed right when the thresholds were set, routed again
 * against the live model, with a `system` Alert when one no longer lands where
 * it did. The Alert goes to the Organizations the platform owners belong to,
 * because a threshold is a fact about the model and not about any tenant, and
 * that is the one thing only the host knows.
 *
 * Runs once a night on both deployments (`vercel.json`, `deploy/cron/crontab`),
 * about 160 decisions, well under a cent. With no decision key it reports
 * `skipped` and touches nothing.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withCronAuth(async () => {
  const db = getWidgetDb();
  return Response.json(
    await runPreflightDriftReplay({
      db,
      organizationIds: await platformOwnerOrganizationIds(db),
    })
  );
});
