import { withCronAuth } from "@/lib/cron-auth";
import { sweepOrphanedKnowledgeOriginals } from "@/lib/storage/knowledge-orphans";
import {
  createSupabaseServiceClient,
  isSupabaseServiceConfigured,
} from "@/lib/supabase/service";
import { getWidgetDb } from "@/lib/widget-db";
import {
  sweepExpiredObjectAccess,
  sweepExpiredTraces,
  sweepExpiredTranscripts,
} from "@agent-hub/agent";

/**
 * Retention sweeps (#573 traces, #801/CYB-12 transcripts), the HTTP adapter.
 *
 * Cron auth in, the tick's report out. What a tick actually does lives in
 * `@agent-hub/agent`, where it is tested without a request: `sweepExpiredTraces`
 * strips expired Turn Traces and keeps the messages, `sweepExpiredTranscripts`
 * deletes whole expired Conversations. The route was `sweep-traces` until the
 * second sweep joined it; a name that says "traces" over a tick that deletes
 * transcripts is the kind of surprise a rename is for.
 *
 * Scheduled daily in vercel.json; both sweeps are idempotent, so a finer
 * schedule only changes how promptly expired data disappears. Protected by
 * CRON_SECRET (Vercel sends it as a Bearer token); without the secret
 * configured we refuse to run.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const noOrphans = { knowledgeOrphansScannedOrgs: 0, knowledgeOrphansRemoved: 0 };

export const GET = withCronAuth(async () => {
  const db = getWidgetDb();
  // Three policies, one tick: the two tenant-set windows (either, both, or
  // neither, #801/CYB-12) and the fixed operational window on the
  // object-access ledger (#801/CYB-19). One schedule, one report to read.
  // Plus the storage backstop: knowledge originals no Source names any more
  // (an Organization deleted whole, or files orphaned before Source deletes
  // removed them). Isolated, a storage outage must not fail the row sweeps.
  const [traces, transcripts, objectAccess, knowledgeOrphans] = await Promise.all([
    sweepExpiredTraces({ db }),
    sweepExpiredTranscripts({ db }),
    sweepExpiredObjectAccess({ db }),
    isSupabaseServiceConfigured()
      ? sweepOrphanedKnowledgeOriginals(createSupabaseServiceClient()).catch((error) => {
          console.error("[retention] knowledge orphan sweep failed:", error);
          return noOrphans;
        })
      : noOrphans,
  ]);
  return Response.json({ ...traces, ...transcripts, ...objectAccess, ...knowledgeOrphans });
});
