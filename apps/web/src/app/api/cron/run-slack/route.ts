import { runDueSlackMentionJobs } from "@agent-hub/agent";
import { withCronAuth } from "@/lib/cron-auth";
import { getWidgetDb } from "@/lib/widget-db";
import { getRuntimeDb } from "@/lib/runtime-db";
import { isSupabaseServiceConfigured } from "@/lib/supabase/service";

/**
 * The Slack mention drain (#857): retries the event route's after-response
 * hook could not finish, and jobs whose worker died mid-turn. Every five
 * minutes on a self-host; daily on Vercel's Hobby plan, which refuses anything
 * more frequent, so a hosted retry can wait until the next mention or the next
 * night until the plan is Pro.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const GET = withCronAuth(async () => {
  if (!isSupabaseServiceConfigured())
    return new Response("Slack worker not configured", { status: 503 });
  return Response.json(
    await runDueSlackMentionJobs(
      { db: getRuntimeDb(getWidgetDb()) },
      { budgetMs: maxDuration * 1000 },
    ),
  );
});
