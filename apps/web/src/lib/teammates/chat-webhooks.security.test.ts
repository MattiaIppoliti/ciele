import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Chat } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { teammateChatAdapter } from "./chat-bot";
import type { TeammateChatConnection } from "./chat-connections";

const common = {
  id: "auth-fixture",
  organizationId: "org",
  teammateId: "coworker",
  allowedChannelIds: ["channel"],
  users: [{ remoteUserId: "user", memberId: "member" }],
};
beforeEach(() => {
  vi.stubEnv("TEST_BOT", "fixture-bot-token");
  vi.stubEnv("TEST_SIGNING", "fixture-signing-secret");
  vi.stubEnv("TEST_WEBHOOK", "fixture-webhook-secret");
  vi.stubEnv("TEST_APP", "00000000-0000-4000-8000-000000000001");
  vi.stubEnv("TEST_PASSWORD", "fixture-password");
});
afterEach(() => vi.unstubAllEnvs());

describe("the configured SDK adapters authenticate webhooks", () => {
  it("accepts a signed Slack challenge and rejects forged and stale signatures", async () => {
    const connection: TeammateChatConnection = {
      ...common,
      provider: "slack",
      workspaceId: "workspace",
      botTokenEnv: "TEST_BOT",
      signingSecretEnv: "TEST_SIGNING",
    };
    const adapter = teammateChatAdapter(connection);
    const body = JSON.stringify({
      type: "url_verification",
      challenge: "verified",
    });
    const request = (timestamp: number, signing = "fixture-signing-secret") =>
      new Request("https://ciele.test/webhook", {
        method: "POST",
        body,
        headers: {
          "content-type": "application/json",
          "x-slack-request-timestamp": String(timestamp),
          "x-slack-signature":
            "v0=" +
            createHmac("sha256", signing)
              .update(`v0:${timestamp}:${body}`)
              .digest("hex"),
        },
      });
    const now = Math.floor(Date.now() / 1000);
    expect((await adapter.handleWebhook(request(now, "wrong"))).status).toBe(
      401,
    );
    expect((await adapter.handleWebhook(request(now - 600))).status).toBe(401);
    const accepted = await adapter.handleWebhook(request(now));
    expect(accepted.status).toBe(200);
    expect(await accepted.text()).toContain("verified");
  });
  it("requires the bot-specific Telegram webhook secret", async () => {
    const connection: TeammateChatConnection = {
      ...common,
      provider: "telegram",
      botTokenEnv: "TEST_BOT",
      webhookSecretEnv: "TEST_WEBHOOK",
    };
    const adapter = teammateChatAdapter(connection);
    const request = (secret?: string) =>
      new Request("https://ciele.test/webhook", {
        method: "POST",
        body: "{}",
        headers: secret ? { "x-telegram-bot-api-secret-token": secret } : {},
      });
    expect((await adapter.handleWebhook(request())).status).toBe(401);
    expect((await adapter.handleWebhook(request("wrong"))).status).toBe(401);
    expect(
      (await adapter.handleWebhook(request("fixture-webhook-secret"))).status,
    ).toBe(200);
  });
  it("rejects unsigned Teams activities before a conversation callback", async () => {
    const connection: TeammateChatConnection = {
      ...common,
      provider: "teams",
      tenantId: "00000000-0000-4000-8000-000000000002",
      appIdEnv: "TEST_APP",
      appPasswordEnv: "TEST_PASSWORD",
    };
    const adapter = teammateChatAdapter(connection);
    const bot = new Chat({
      userName: "Fixture",
      adapters: { teams: adapter },
      state: createMemoryState(),
      logger: "silent",
    });
    await bot.initialize();
    const request = new Request("https://ciele.test/webhook", {
      method: "POST",
      body: JSON.stringify({
        type: "message",
        id: "fixture",
        channelId: "msteams",
        text: "Hello",
        conversation: { id: "conversation", tenantId: connection.tenantId },
        channelData: { tenant: { id: connection.tenantId } },
      }),
    });
    try {
      expect((await adapter.handleWebhook(request)).status).toBe(401);
    } finally {
      await bot.shutdown();
    }
  });
});
