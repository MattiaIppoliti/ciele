import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message, Thread } from "chat";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { teammateChatHandler } from "./chat-bot";
import {
  chatTenantMatches,
  teammateChatConnections,
  type TeammateChatConnection,
} from "./chat-connections";

const db = getMockDb();
// The model can remain offline while the real persisted turn and member guards run.
vi.mock("./actions", () => ({ resolveTeammateActions: async () => [] }));
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  vi.stubEnv("CIELE_COMPUTER_SUPERVISOR_URL", "");
  vi.stubEnv("CIELE_AG_UI_HARNESSES", "[]");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function fixture(provider: "slack" | "telegram" | "teams" = "slack") {
  const teammate = await db
    .table("teammates")
    .insert({
      organizationId: DEMO_ORG.id,
      ownerId: DEMO_MEMBER.userId,
      name: "Channel coworker",
    });
  const common = {
    id: teammate.id,
    organizationId: DEMO_ORG.id,
    teammateId: teammate.id,
    allowedChannelIds: ["permitted-channel"],
    users: [{ remoteUserId: "remote-user", memberId: DEMO_MEMBER.userId }],
  };
  const connection: TeammateChatConnection =
    provider === "slack"
      ? {
          ...common,
          provider,
          workspaceId: "workspace",
          botTokenEnv: "TEST_BOT",
          signingSecretEnv: "TEST_SIGNING",
        }
      : provider === "telegram"
        ? {
            ...common,
            provider,
            botTokenEnv: "TEST_BOT",
            webhookSecretEnv: "TEST_WEBHOOK",
          }
        : {
            ...common,
            provider,
            tenantId: "tenant",
            appIdEnv: "TEST_APP",
            appPasswordEnv: "TEST_PASSWORD",
          };
  const thread = {
    id: "external-thread",
    channelId: "permitted-channel",
    isDM: true,
    subscribe: vi.fn<Thread["subscribe"]>(),
    post: vi.fn<Thread["post"]>(),
  };
  const message: Pick<Message, "id" | "text" | "author"> = {
    id: "message-1",
    text: "Hello",
    author: {
      userId: "remote-user",
      userName: "remote",
      fullName: "Remote User",
      isBot: false,
      isMe: false,
    },
  };
  const handle = teammateChatHandler({ connection, systemDb: db });
  return { teammate, connection, thread, message, handle };
}
describe("messaging identity and persistence", () => {
  for (const provider of ["slack", "telegram", "teams"]) {
    it(
      "uses the native persisted turn for " +
        provider +
        " and replays a delivery without another user message",
      async () => {
        const selected =
          provider === "slack"
            ? "slack"
            : provider === "telegram"
              ? "telegram"
              : "teams";
        const { teammate, thread, message, handle } = await fixture(selected);
        await handle(thread, message);
        expect(thread.post).toHaveBeenCalledOnce();
        const conversations = await db.listTeammateConversations(
          teammate.id,
          DEMO_MEMBER.userId,
        );
        expect(conversations).toHaveLength(1);
        const conversation = conversations[0];
        if (!conversation) throw new Error("Conversation was not persisted");
        await handle(thread, message);
        expect(
          (await db.listMessages(conversation.id)).filter(
            (row) => row.role === "user",
          ),
        ).toHaveLength(1);
      },
    );
  }
  it("refuses unmapped senders, bots, forbidden channels and absent memberships before any turn", async () => {
    const { teammate, connection, thread, message, handle } = await fixture();
    await handle(thread, {
      ...message,
      author: { ...message.author, userId: "unmapped" },
    });
    await handle(thread, {
      ...message,
      author: { ...message.author, isBot: true },
    });
    await handle({ ...thread, channelId: "forbidden" }, message);
    await teammateChatHandler({
      systemDb: db,
      connection: {
        ...connection,
        users: [{ remoteUserId: "remote-user", memberId: "removed-member" }],
      },
    })(thread, message);
    expect(thread.subscribe).not.toHaveBeenCalled();
    expect(thread.post).not.toHaveBeenCalled();
    expect(
      await db.listTeammateConversations(teammate.id, DEMO_MEMBER.userId),
    ).toEqual([]);
  });
  it("will not expose a private teammate in a group or resolve a teammate from another Organization", async () => {
    const { teammate, connection, thread, message, handle } = await fixture();
    await db.table("teammates").update(teammate.id, { visibility: "private" });
    await handle({ ...thread, isDM: false }, message);
    await teammateChatHandler({
      systemDb: db,
      connection: { ...connection, organizationId: "foreign" },
    })(thread, message);
    expect(thread.post).not.toHaveBeenCalled();
  });
  it("withholds a group answer when the teammate becomes private during the turn", async () => {
    const { teammate, thread, message, handle } = await fixture();
    thread.subscribe.mockImplementation(async () => {
      await db.table("teammates").update(teammate.id, { visibility: "private" });
    });
    await handle({ ...thread, isDM: false }, message);
    expect(thread.subscribe).toHaveBeenCalledOnce();
    expect(thread.post).not.toHaveBeenCalled();
  });
  it("pins Slack workspaces and Teams tenants, while leaving challenges to signature verification", async () => {
    const slack = (await fixture()).connection;
    expect(chatTenantMatches(slack, { team_id: "workspace" })).toBe(true);
    expect(chatTenantMatches(slack, { team_id: "foreign" })).toBe(false);
    expect(chatTenantMatches(slack, { type: "url_verification" })).toBe(true);
    const teams = (await fixture("teams")).connection;
    expect(
      chatTenantMatches(teams, { channelData: { tenant: { id: "tenant" } } }),
    ).toBe(true);
    expect(
      chatTenantMatches(teams, { channelData: { tenant: { id: "foreign" } } }),
    ).toBe(false);
  });
  it("refuses ambiguous remote identities and duplicate operator connections", async () => {
    const { connection } = await fixture();
    vi.stubEnv(
      "CIELE_CHAT_CONNECTIONS",
      JSON.stringify([connection, connection]),
    );
    expect(teammateChatConnections).toThrow("unique");
    vi.stubEnv(
      "CIELE_CHAT_CONNECTIONS",
      JSON.stringify([
        {
          ...connection,
          users: [
            ...connection.users,
            { remoteUserId: "remote-user", memberId: "someone-else" },
          ],
        },
      ]),
    );
    expect(teammateChatConnections).toThrow("exactly one");
  });
});
