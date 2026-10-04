import { z } from "zod";

const common = {
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  organizationId: z.string().min(1),
  teammateId: z.string().min(1),
  allowedChannelIds: z.array(z.string().min(1)).min(1).max(100),
  users: z
    .array(
      z
        .object({
          remoteUserId: z.string().min(1),
          memberId: z.string().min(1),
        })
        .strict(),
    )
    .min(1)
    .max(500),
};
const secret = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
export const chatConnectionSchema = z.discriminatedUnion("provider", [
  z
    .object({
      ...common,
      provider: z.literal("slack"),
      workspaceId: z.string().min(1),
      botTokenEnv: secret,
      signingSecretEnv: secret,
    })
    .strict(),
  z
    .object({
      ...common,
      provider: z.literal("telegram"),
      botTokenEnv: secret,
      webhookSecretEnv: secret,
    })
    .strict(),
  z
    .object({
      ...common,
      provider: z.literal("teams"),
      tenantId: z.string().min(1),
      appIdEnv: secret,
      appPasswordEnv: secret,
    })
    .strict(),
]);
export type TeammateChatConnection = z.infer<typeof chatConnectionSchema>;
export function teammateChatConnections() {
  const raw: unknown = JSON.parse(process.env.CIELE_CHAT_CONNECTIONS || "[]");
  const result = z.array(chatConnectionSchema).max(100).parse(raw);
  if (new Set(result.map((entry) => entry.id)).size !== result.length)
    throw new Error("Chat connection IDs must be unique");
  for (const connection of result) {
    if (
      new Set(connection.users.map((user) => user.remoteUserId)).size !==
      connection.users.length
    )
      throw new Error("A remote user must map to exactly one Ciele member");
  }
  return result;
}
export function connectionSecret(name: string) {
  const secret = process.env[name]?.trim();
  if (!secret) throw new Error("A messaging connection credential is missing");
  return secret;
}

/** Tenant claims are checked in addition to the SDK's signature/JWT verification. */
export function chatTenantMatches(
  connection: TeammateChatConnection,
  payload: unknown,
) {
  if (!payload || typeof payload !== "object") return false;
  if (connection.provider === "telegram") return true; // Bot-specific webhook secret is verified by the adapter.
  // Slack's verification challenge has no workspace claim. The adapter still
  // verifies its signature and this event cannot enter a conversation handler.
  if (connection.provider === "slack")
    return (
      ("type" in payload && payload.type === "url_verification") ||
      ("team_id" in payload && payload.team_id === connection.workspaceId)
    );
  if (
    !("channelData" in payload) ||
    !payload.channelData ||
    typeof payload.channelData !== "object"
  )
    return false;
  const data = payload.channelData;
  return (
    "tenant" in data &&
    data.tenant !== null &&
    typeof data.tenant === "object" &&
    "id" in data.tenant &&
    data.tenant.id === connection.tenantId
  );
}
