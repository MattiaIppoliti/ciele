import type { ApplicationConnection } from "./types";

/**
 * The Slack conversational opt-in: which published Assistant answers mentions
 * in which channels of one connected workspace. Stored on the Slack
 * Application Connection's metadata under `slackBot`, and read from there by
 * the signed event route, the mention worker, the settings save and the
 * console dialog. This is the one parser, so a row every one of them agrees is
 * malformed is refused the same way everywhere.
 *
 * Explicit publication to Slack: an Assistant is never inferred from an Import.
 */
export interface SlackBotConfig {
  assistantId: string;
  channelIds: string[];
}

/** The two scopes a mention reply needs beyond the Import floor. */
export const SLACK_BOT_SCOPES = ["app_mentions:read", "chat:write"];

/** Public or private Slack channel id, as `conversations.*` report them. */
export const SLACK_CHANNEL_ID = /^[CG][A-Z0-9]+$/;

export function slackBotConfig(
  metadata: Record<string, unknown>,
): SlackBotConfig | null {
  const value = metadata.slackBot as Partial<SlackBotConfig> | undefined;
  if (
    !value ||
    typeof value.assistantId !== "string" ||
    !value.assistantId ||
    !Array.isArray(value.channelIds) ||
    value.channelIds.length === 0 ||
    value.channelIds.length > 50 ||
    !value.channelIds.every(
      (id) => typeof id === "string" && SLACK_CHANNEL_ID.test(id),
    )
  )
    return null;
  return {
    assistantId: value.assistantId,
    channelIds: [...new Set(value.channelIds)],
  };
}

/**
 * Whether a connected Slack row can carry a bot opt-in: connected, renewed by
 * an installation the token response identified (app + bot user), and granted
 * both reply scopes. One predicate for the dialog's "authorize first" button,
 * the settings save and the worker's pre-turn check.
 */
export function slackBotReady(
  connection: Pick<ApplicationConnection, "status" | "scopes" | "metadata">,
): boolean {
  return (
    connection.status === "connected" &&
    typeof connection.metadata.slackAppId === "string" &&
    connection.metadata.slackAppId.length > 0 &&
    typeof connection.metadata.slackBotUserId === "string" &&
    /^[UW][A-Z0-9]+$/.test(connection.metadata.slackBotUserId) &&
    SLACK_BOT_SCOPES.every((scope) => connection.scopes.includes(scope))
  );
}
