"use server";

import { requireMember } from "@/lib/authz";
import { revalidateEntities } from "@/lib/org-mutation";
import { saveSlackBotSettings } from "@/lib/slack/settings";
import type { SlackBotConfig } from "@/lib/slack/config";
import { isSupabaseServiceConfigured } from "@/lib/supabase/service";

export async function configureSlackBotAction(
  connectionId: string,
  config: SlackBotConfig | null,
) {
  const { db, organizationId } = await requireMember("publish");
  if (
    config !== null &&
    (!process.env.SLACK_APPLICATION_APP_ID ||
      !process.env.SLACK_SIGNING_SECRET ||
      !isSupabaseServiceConfigured())
  ) {
    throw new Error(
      "Configure Slack event delivery on this deployment first: SLACK_APPLICATION_APP_ID and SLACK_SIGNING_SECRET are required.",
    );
  }
  await saveSlackBotSettings(db, organizationId, connectionId, config);
  revalidateEntities([{ kind: "knowledgeHub" }], organizationId);
}
