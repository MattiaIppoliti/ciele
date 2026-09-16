import type { Db } from "@agent-hub/db";
import { slackBotConfig, SLACK_BOT_SCOPES } from "./config";

export async function saveSlackBotSettings(
  db: Db,
  organizationId: string,
  connectionId: string,
  value: unknown,
) {
  const connection = await db.getSafeApplicationConnection(connectionId);
  if (
    !connection ||
    connection.organizationId !== organizationId ||
    connection.provider !== "slack" ||
    connection.ownerType !== "organization"
  )
    throw new Error("Slack connection not found");
  const metadata = { ...connection.metadata };
  if (value === null) {
    delete metadata.slackBot;
  } else {
    const config = slackBotConfig({ slackBot: value });
    if (!config)
      throw new Error(
        "Select an Assistant and between 1 and 50 Slack channels",
      );
    if (
      connection.status !== "connected" ||
      !connection.metadata.slackAppId ||
      !connection.metadata.slackBotUserId ||
      !SLACK_BOT_SCOPES.every((scope) => connection.scopes.includes(scope))
    ) {
      throw new Error("Reconnect Slack with conversational permissions first");
    }
    const publication = await db.getLatestPublication(config.assistantId);
    if (
      !publication ||
      publication.config.assistant.organizationId !== organizationId
    ) {
      throw new Error("Publish an Assistant from this Organization first");
    }
    if (publication.config.assistant.requireSignIn) {
      throw new Error(
        "This Assistant requires SSO. Slack identity is not linked to Ciele SSO",
      );
    }
    metadata.slackBot = config;
  }
  await db.updateApplicationConnection(connection.id, { metadata });
}
