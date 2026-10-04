import { createHash } from "node:crypto";
import {
  Chat,
  type Adapter,
  type Message,
  type MessageContext,
  type Thread,
} from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createTeamsAdapter } from "@chat-adapter/teams";
import { createRedisState } from "@chat-adapter/state-redis";
import { canViewTeammate, messageText } from "@agent-hub/core";
import {
  consumeTurnStream,
  EMPTY_TURN_TRACE,
  type TurnView,
} from "@agent-hub/agent/client";
import { createOrgPinnedDb, type Db } from "@agent-hub/db";
import { getServiceRoleDb } from "@/lib/service-db";
import { reportError } from "@agent-hub/diagnostics";
import {
  connectionSecret,
  type TeammateChatConnection,
} from "./chat-connections";
import { streamTransportTeammateTurn } from "./transport";

/** Called only after a platform adapter verified the incoming request. No inferred email identity. */
export function teammateChatHandler(options: {
  connection: TeammateChatConnection;
  systemDb: Db;
}) {
  const { connection, systemDb } = options;
  return async (
    thread: Pick<Thread, "id" | "channelId" | "isDM" | "post" | "subscribe">,
    message: Pick<Message, "id" | "text" | "author">,
  ) => {
    if (
      message.author.isBot !== false ||
      message.author.isMe ||
      message.author.isSystem
    )
      return;
    if (!connection.allowedChannelIds.includes(thread.channelId)) return;
    const mapped = connection.users.find(
      (user) => user.remoteUserId === message.author.userId,
    );
    if (!mapped || !message.text.trim() || message.text.length > 32000) return;
    const db = createOrgPinnedDb(systemDb, connection.organizationId);
    const [role, teammate] = await Promise.all([
      systemDb.getMemberRole(connection.organizationId, mapped.memberId),
      db.table("teammates").get(connection.teammateId),
    ]);
    if (
      !role ||
      !teammate ||
      teammate.deletedAt ||
      !canViewTeammate(teammate, { userId: mapped.memberId, role })
    )
      return;
    if (teammate.visibility === "private" && !thread.isDM) return;
    await thread.subscribe();
    const turnId = `chat_${createHash("sha256")
      .update(JSON.stringify([connection.id, thread.id, message.id]))
      .digest("hex")}`;
    const signal = AbortSignal.timeout(240000);
    const stream = await streamTransportTeammateTurn({
      db,
      systemDb,
      teammate,
      memberId: mapped.memberId,
      role,
      signal,
      message: message.text,
      threadId: `chat:${connection.id}:${thread.id}`,
      turnId,
    });
    let view: TurnView = { ...EMPTY_TURN_TRACE, parts: [], streamingText: "" };
    let failed = false;
    await consumeTurnStream(stream, {
      update: (update) => {
        view = update(view);
      },
      onEvent: (event) => {
        if (event.type === "error") failed = true;
      },
    });
    // A long turn does not retain a membership or a private Teammate's old visibility.
    const [currentRole, currentTeammate] = await Promise.all([
      systemDb.getMemberRole(connection.organizationId, mapped.memberId),
      db.table("teammates").get(connection.teammateId),
    ]);
    if (
      !currentRole ||
      !currentTeammate ||
      currentTeammate.deletedAt ||
      !canViewTeammate(currentTeammate, {
        userId: mapped.memberId,
        role: currentRole,
      })
    )
      return;
    if (currentTeammate.visibility === "private" && !thread.isDM) return;
    const answer = failed
      ? "This request could not complete. Open Ciele to review the turn."
      : messageText(view.parts);
    await thread.post({
      markdown:
        answer || "Open Ciele to review this turn and any pending approvals.",
    });
  };
}

export function teammateChatAdapter(
  connection: TeammateChatConnection,
): Adapter {
  switch (connection.provider) {
    case "slack":
      return createSlackAdapter({
        botToken: () => connectionSecret(connection.botTokenEnv),
        signingSecret: connectionSecret(connection.signingSecretEnv),
        mode: "webhook",
      });
    case "telegram":
      return createTelegramAdapter({
        botToken: () => connectionSecret(connection.botTokenEnv),
        secretToken: connectionSecret(connection.webhookSecretEnv),
        allowedUserIds: connection.users.map((user) => user.remoteUserId),
        mode: "webhook",
      });
    case "teams":
      return createTeamsAdapter({
        appId: connectionSecret(connection.appIdEnv),
        appPassword: connectionSecret(connection.appPasswordEnv),
        appTenantId: connection.tenantId,
        appType: "SingleTenant",
      });
  }
}

const bots = new Map<
  string,
  { config: string; bot: Chat<Record<string, Adapter>> }
>();
export function teammateChatBot(connection: TeammateChatConnection) {
  const credentialNames =
    connection.provider === "teams"
      ? [connection.appIdEnv, connection.appPasswordEnv]
      : [
          connection.botTokenEnv,
          connection.provider === "slack"
            ? connection.signingSecretEnv
            : connection.webhookSecretEnv,
        ];
  const signature = createHash("sha256")
    .update(
      JSON.stringify([
        connection,
        process.env.CIELE_CHAT_REDIS_URL,
        credentialNames.map(connectionSecret),
      ]),
    )
    .digest("hex");
  const cached = bots.get(connection.id);
  if (cached?.config === signature) return cached.bot;
  const redisUrl = process.env.CIELE_CHAT_REDIS_URL;
  if (!redisUrl) throw new Error("Messaging requires persistent Redis state");
  const adapter = teammateChatAdapter(connection);
  const bot = new Chat<Record<string, Adapter>>({
    userName: "Ciele",
    adapters: { [connection.provider]: adapter },
    state: createRedisState({
      url: redisUrl,
      keyPrefix: `ciele:chat:${connection.id}`,
    }),
    dedupeTtlMs: 24 * 60 * 60 * 1000,
    concurrency: {
      strategy: "queue",
      maxQueueSize: 10,
      onQueueFull: "drop-newest",
      queueEntryTtlMs: 600000,
      maxLockLifetimeMs: 600000,
    },
    logger: "silent",
  });
  const handler = teammateChatHandler({
    connection,
    systemDb: getServiceRoleDb(),
  });
  const observed = async (
    thread: Thread,
    message: Message,
    context?: MessageContext,
  ) => {
    // The SDK supplies earlier queued messages as `skipped`. Each keeps its
    // own sender and delivery ID; never combine different members' messages.
    try {
      for (const queued of [...(context?.skipped ?? []), message])
        await handler(thread, queued);
    } catch (error) {
      reportError("teammate.channel", error, {
        organizationId: connection.organizationId,
      });
      throw error;
    }
  };
  bot.onNewMention(observed);
  bot.onSubscribedMessage(observed);
  bot.onDirectMessage((thread, message, _channel, context) =>
    observed(thread, message, context),
  );
  bots.set(connection.id, { config: signature, bot });
  return bot;
}
