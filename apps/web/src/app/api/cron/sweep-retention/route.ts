import { withCronAuth } from "@/lib/cron-auth";
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

export const GET = withCronAuth(async () => {
  const db = getWidgetDb();
  // Three policies, one tick: the two tenant-set windows (either, both, or
  // neither, #801/CYB-12) and the fixed operational window on the
  // object-access ledger (#801/CYB-19). One schedule, one report to read.
  const [traces, transcripts, objectAccess] = await Promise.all([
    sweepExpiredTraces({ db }),
    sweepExpiredTranscripts({ db }),
    sweepExpiredObjectAccess({ db }),
  ]);
  return Response.json({ ...traces, ...transcripts, ...objectAccess });
});
