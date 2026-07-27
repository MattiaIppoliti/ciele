import { withCronAuth } from "@/lib/cron-auth";
import { runGraphLearning } from "@agent-hub/agent";
import { getWidgetDb } from "@/lib/widget-db";

/**
 * Nightly graph-learning pass (ADR-0017 / #389). For every active graph dataset
 * (cross-org, via the service role) it applies feedback weights — the zero-LLM
 * stage, always — and runs LLM distillation only for orgs within their daily
 * token budget. Per-org worker failures raise an auto-resolving Alert and are
 * counted, never thrown. Inert (no-op) when no graph worker is configured.
 *
 * Scheduled daily in vercel.json; protected by CRON_SECRET (Vercel sends it as
 * a Bearer token). The response reports the per-run weight/distill/failure
 * counts (AC: weight changes are verifiable).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withCronAuth(async () => {
  const db = getWidgetDb();
  const result = await runGraphLearning({ db });
  return Response.json(result);
});
