/** Explicit publication to Slack: never infer an Assistant from an import. */
export interface SlackBotConfig {
  assistantId: string;
  channelIds: string[];
}

export const SLACK_BOT_SCOPES = ["app_mentions:read", "chat:write"];

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
      (id) => typeof id === "string" && /^[CG][A-Z0-9]+$/.test(id),
    )
  )
    return null;
  return {
    assistantId: value.assistantId,
    channelIds: [...new Set(value.channelIds)],
  };
}
