import { withCronAuth } from "@/lib/cron-auth";
import { getWidgetDb } from "@/lib/widget-db";
import { getRuntimeDb } from "@/lib/runtime-db";
import { isSupabaseServiceConfigured } from "@/lib/supabase/service";
import { runSlackMentionJobs } from "@/lib/slack/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const GET = withCronAuth(async () => {
  if (!isSupabaseServiceConfigured())
    return new Response("Slack worker not configured", { status: 503 });
  return Response.json(
    await runSlackMentionJobs({ db: getRuntimeDb(getWidgetDb()) }),
  );
});
