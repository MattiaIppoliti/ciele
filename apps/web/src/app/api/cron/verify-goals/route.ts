import { withCronAuth } from "@/lib/cron-auth";
import { getWidgetDb } from "@/lib/widget-db";
import {
  runCompostPass,
  runDueAnswerVerifications,
  runDueGoalEvals,
  runTrustMaterialization,
} from "@/lib/runtime";

/**
 * Standing-goal re-verification tick (spec: scheduled golden-question checks
 * feeding Alerts). Claims a bounded, least-recently-run batch of due goals
 * across all orgs (service role), runs each headlessly against its
 * assistant's latest Publication, and raises/auto-resolves the per-goal
 * Alert. Protected by CRON_SECRET like the crawl finalizer; the claim stamp
 * doubles as the lease so overlapping ticks never double-run a goal.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Bounded per tick: evals cost tokens; leftovers wait for the next tick. */
const GOAL_EVAL_BATCH_SIZE = 10;

export const GET = withCronAuth(async () => {
  const db = getWidgetDb();
  const goals = await runDueGoalEvals({ db }, { limit: GOAL_EVAL_BATCH_SIZE });
  // The answer verifier rides the same daily tick (deployment-plan cron
  // limit); its per-message unique verdict makes overlapping ticks harmless.
  const verification = await runDueAnswerVerifications({ db });
  // Trust materializes after verification, so tonight's verdicts feed
  // tonight's tiers; compost runs last and only fires per assistant when its
  // weekly window has elapsed (internally gated).
  const trust = await runTrustMaterialization({ db });
  const compost = await runCompostPass({ db });
  return Response.json({ goals, verification, trust, compost });
});
