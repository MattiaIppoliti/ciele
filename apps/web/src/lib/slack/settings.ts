import { slackBotConfig, slackBotReady } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import type { ApplicationScopeOption } from "@agent-hub/agent";

export interface SaveSlackBotOptions {
  /**
   * The Slack app this deployment receives events for. A connection renewed
   * through a different app would save fine and then never see a mention,
   * because the event route drops every event from another app id.
   */
  expectedAppId?: string;
  /**
   * The channels discovery just returned for this connection. When supplied,
   * a channel the bot cannot answer in (not listed, not a member, Slack
   * Connect) is refused here rather than skipped silently per mention.
   */
  channels?: ApplicationScopeOption[];
}

export async function saveSlackBotSettings(
  db: Db,
  organizationId: string,
  connectionId: string,
  value: unknown,
  options: SaveSlackBotOptions = {},
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
    if (!slackBotReady(connection)) {
      throw new Error("Reconnect Slack with conversational permissions first");
    }
    if (
      options.expectedAppId &&
      connection.metadata.slackAppId !== options.expectedAppId
    ) {
      throw new Error(
        "This Slack connection belongs to a different Slack app than the one this deployment receives events for. Reconnect Slack, or check SLACK_APPLICATION_APP_ID.",
      );
    }
    if (options.channels) {
      const byId = new Map(
        options.channels
          .filter((scope) => scope.kind === "channel")
          .map((scope) => [scope.id, scope] as const),
      );
      for (const channelId of config.channelIds) {
        const channel = byId.get(channelId);
        const label = channel?.label ?? channelId;
        if (!channel) {
          throw new Error(
            `Ciele cannot see Slack channel ${label}. Invite it to the channel, then reopen this dialog.`,
          );
        }
        if (channel.metadata.member === false) {
          throw new Error(`Invite Ciele to ${label} before selecting it.`);
        }
        if (channel.metadata.shared === true) {
          throw new Error(
            `${label} is a Slack Connect channel; shared channels are not supported.`,
          );
        }
      }
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
