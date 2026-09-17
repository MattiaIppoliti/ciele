import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPublicationConfig, sealSecret } from "@agent-hub/core";
import { getMockDb, resetMockDb } from "@agent-hub/db";
import type { ApplicationScopeOption } from "@agent-hub/agent";
import { saveSlackBotSettings } from "./settings";

const db = getMockDb();
const channelId = "CTEST";

beforeEach(() => {
  resetMockDb();
  process.env.APP_ENCRYPTION_KEY = "slack-test-key";
});
afterEach(() => {
  delete process.env.APP_ENCRYPTION_KEY;
});

async function fixture(teamId = "TTEST") {
  const organizationId = randomUUID();
  const assistant = await db.createAssistant(organizationId, { title: "Support" });
  await db.createPublication(
    assistant.id,
    buildPublicationConfig(assistant, await db.listFlows(assistant.id), []),
  );
  const connection = await db.createApplicationConnection({
    organizationId,
    provider: "slack",
    name: "Slack",
    sealedCredentials: sealSecret(JSON.stringify({ accessToken: "t", teamId })),
    providerAccountId: teamId,
    scopes: ["app_mentions:read", "chat:write", "channels:history"],
    metadata: { slackAppId: "ATEST", slackBotUserId: "UBOT", teamName: "Test" },
  });
  return { organizationId, assistant, connection };
}

const channel = (
  id: string,
  metadata: Record<string, unknown> = { member: true },
): ApplicationScopeOption => ({
  id,
  label: `#${id.toLowerCase()}`,
  kind: "channel",
  parentId: null,
  metadata,
});

describe("saveSlackBotSettings", () => {
  it("rejects foreign or unpublished Assistants, SSO, and missing scopes; disabling preserves metadata", async () => {
    const { organizationId, assistant, connection } = await fixture();
    const foreign = await fixture("TOTHER");
    const settings = { assistantId: foreign.assistant.id, channelIds: [channelId] };
    await expect(
      saveSlackBotSettings(db, organizationId, connection.id, settings),
    ).rejects.toThrow("Publish");
    await expect(
      saveSlackBotSettings(db, foreign.organizationId, connection.id, settings),
    ).rejects.toThrow("not found");
    await expect(
      saveSlackBotSettings(db, organizationId, connection.id, {
        ...settings,
        channelIds: [],
      }),
    ).rejects.toThrow("channels");
    await db.createPublication(
      assistant.id,
      buildPublicationConfig({ ...assistant, requireSignIn: true }, [], []),
    );
    await expect(
      saveSlackBotSettings(db, organizationId, connection.id, {
        ...settings,
        assistantId: assistant.id,
      }),
    ).rejects.toThrow("SSO");
    await db.updateApplicationConnection(connection.id, { scopes: [] });
    await expect(
      saveSlackBotSettings(db, organizationId, connection.id, settings),
    ).rejects.toThrow("Reconnect");
    await db.updateApplicationConnection(connection.id, {
      scopes: ["app_mentions:read", "chat:write"],
      status: "reauthorization_required",
    });
    await expect(
      saveSlackBotSettings(db, organizationId, connection.id, settings),
    ).rejects.toThrow("Reconnect");
    await saveSlackBotSettings(db, organizationId, connection.id, null);
    expect(
      (await db.getSafeApplicationConnection(connection.id))?.metadata,
    ).toEqual({ slackAppId: "ATEST", slackBotUserId: "UBOT", teamName: "Test" });
  });

  it("refuses a connection renewed through a different Slack app than the one receiving events", async () => {
    const { organizationId, assistant, connection } = await fixture();
    const settings = { assistantId: assistant.id, channelIds: [channelId] };
    await expect(
      saveSlackBotSettings(db, organizationId, connection.id, settings, {
        expectedAppId: "ASTAGING",
      }),
    ).rejects.toThrow("SLACK_APPLICATION_APP_ID");
    await saveSlackBotSettings(db, organizationId, connection.id, settings, {
      expectedAppId: "ATEST",
    });
    expect(
      (await db.getSafeApplicationConnection(connection.id))?.metadata.slackBot,
    ).toEqual(settings);
  });

  it("refuses channels the bot cannot answer in when discovery is supplied", async () => {
    const { organizationId, assistant, connection } = await fixture();
    const save = (ids: string[], channels: ApplicationScopeOption[]) =>
      saveSlackBotSettings(
        db,
        organizationId,
        connection.id,
        { assistantId: assistant.id, channelIds: ids },
        { channels },
      );
    await expect(save(["CGONE"], [channel(channelId)])).rejects.toThrow(
      "cannot see",
    );
    await expect(
      save([channelId], [channel(channelId, { member: false })]),
    ).rejects.toThrow("Invite Ciele");
    await expect(
      save([channelId], [channel(channelId, { member: true, shared: true })]),
    ).rejects.toThrow("Slack Connect");
    await save([channelId], [channel(channelId)]);
    expect(
      (await db.getSafeApplicationConnection(connection.id))?.metadata.slackBot,
    ).toEqual({ assistantId: assistant.id, channelIds: [channelId] });
  });
});
