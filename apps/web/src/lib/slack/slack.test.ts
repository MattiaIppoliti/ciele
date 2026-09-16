import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPublicationConfig, sealSecret } from "@agent-hub/core";
import { getMockDb, resetMockDb } from "@agent-hub/db";
import { alertKeys, streamConversationTurn } from "@agent-hub/agent";
import {
  enqueueSlackMention,
  parseSlackMention,
  resolveSlackConnection,
  slackKey,
  verifySlackSignature,
  type SlackMention,
} from "./events";
import { saveSlackBotSettings } from "./settings";
import { runSlackMentionJobs, slackChannelContext, slackReply } from "./worker";

const db = getMockDb();
const mention: SlackMention = {
  eventId: "EvTEST",
  teamId: "TTEST",
  appId: "ATEST",
  channel: "CTEST",
  user: "UTEST",
  text: "<@UBOT> hello",
  ts: "1770000002.000001",
  threadTs: "1770000000.000001",
};

beforeEach(() => {
  resetMockDb();
  vi.stubEnv("APP_ENCRYPTION_KEY", "slack-test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function fixture(teamId = mention.teamId) {
  const organizationId = randomUUID();
  const assistant = await db.createAssistant(organizationId, {
    title: "Support",
  });
  await db.createPublication(
    assistant.id,
    buildPublicationConfig(assistant, await db.listFlows(assistant.id), []),
  );
  const connection = await db.createApplicationConnection({
    organizationId,
    provider: "slack",
    name: "Slack",
    sealedCredentials: sealSecret(
      JSON.stringify({ accessToken: "test-token", teamId }),
    ),
    providerAccountId: teamId,
    scopes: ["app_mentions:read", "chat:write", "channels:history"],
    metadata: {
      slackAppId: mention.appId,
      slackBotUserId: "UBOT",
      teamName: "Test",
      slackBot: { assistantId: assistant.id, channelIds: [mention.channel] },
    },
  });
  return { organizationId, assistant, connection };
}

function slackFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn<typeof fetch>(async (url) => {
    const method = String(url).split("/").at(-1)!;
    if (overrides[method] instanceof Error) throw overrides[method];
    if (overrides[method] instanceof Response)
      return overrides[method] as Response;
    return Response.json(
      overrides[method] ??
        (method === "conversations.info"
          ? { ok: true, channel: { id: mention.channel, is_member: true } }
          : {
              ok: true,
              messages: [
                {
                  ts: "1770000001.000001",
                  user: "UOTHER",
                  text: "The deadline is Friday.",
                },
              ],
            }),
    );
  });
}

describe("Slack boundary", () => {
  it("authenticates the raw body and rejects tampering, stale timestamps and malformed signatures", () => {
    const body = '{"challenge":"challenge"}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = new Headers({
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": `v0=${createHmac("sha256", "secret").update(`v0:${timestamp}:${body}`).digest("hex")}`,
    });
    expect(verifySlackSignature(body, headers, "secret")).toBe(true);
    expect(verifySlackSignature(body + " ", headers, "secret")).toBe(false);
    expect(
      verifySlackSignature(body, headers, "secret", Date.now() + 301000),
    ).toBe(false);
    headers.set("x-slack-signature", "v0=bad");
    expect(verifySlackSignature(body, headers, "secret")).toBe(false);
  });

  it("accepts mentions only for this app, excluding bots, DMs and shared channels", () => {
    const body = {
      type: "event_callback",
      api_app_id: mention.appId,
      team_id: mention.teamId,
      event_id: mention.eventId,
      event: {
        type: "app_mention",
        channel: mention.channel,
        user: mention.user,
        text: mention.text,
        ts: mention.ts,
      },
    };
    expect(parseSlackMention(body, mention.appId)?.threadTs).toBe(mention.ts);
    expect(parseSlackMention(body, "AOTHER")).toBeNull();
    expect(
      parseSlackMention(
        { ...body, is_ext_shared_channel: true },
        mention.appId,
      ),
    ).toBeNull();
    for (const patch of [
      { bot_id: "BBOT" },
      { channel: "DTEST" },
      { subtype: "message_changed" },
    ]) {
      expect(
        parseSlackMention(
          { ...body, event: { ...body.event, ...patch } },
          mention.appId,
        ),
      ).toBeNull();
    }
  });

  it("routes by workspace, app and explicit channel opt-in, never by a hard-coded or default org", async () => {
    const { connection } = await fixture();
    expect((await resolveSlackConnection(db, mention))?.id).toBe(connection.id);
    expect(
      await resolveSlackConnection(db, { ...mention, teamId: "TOTHER" }),
    ).toBeNull();
    expect(
      await resolveSlackConnection(db, { ...mention, appId: "AOTHER" }),
    ).toBeNull();
    expect(
      await resolveSlackConnection(db, { ...mention, channel: "COTHER" }),
    ).toBeNull();
    await fixture(); // same workspace connected to two orgs with the same enabled channel
    expect(await resolveSlackConnection(db, mention)).toBeNull();
  });

  it("rejects foreign or unpublished Assistants, SSO, and missing scopes; disabling preserves metadata", async () => {
    const { organizationId, assistant, connection } = await fixture();
    const foreign = await fixture("TOTHER");
    const settings = {
      assistantId: foreign.assistant.id,
      channelIds: [mention.channel],
    };
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
    await saveSlackBotSettings(db, organizationId, connection.id, null);
    expect(
      (await db.getSafeApplicationConnection(connection.id))?.metadata,
    ).toEqual({
      slackAppId: "ATEST",
      slackBotUserId: "UBOT",
      teamName: "Test",
    });
  });
});

describe("Slack worker", () => {
  it("delivers streamed model text together with citations using the org provider connections", async () => {
    const { organizationId } = await fixture();
    const connections = await db.listProviderConnections(organizationId);
    const events = [
      { type: "text-start", action: "search_knowledge" },
      { type: "text-delta", delta: "Ciele è " },
      { type: "text-delta", delta: "una piattaforma per assistenti AI." },
      { type: "text-end" },
      { type: "part", part: { type: "sources", action: "search_knowledge", sources: [
        { sourceName: "Ciele Docs", conceptTitle: "Overview", collectionName: "Docs", url: "https://docs.ciele.app/" },
      ] } },
      { type: "done", conversationId: "test", messageId: "reply" },
    ];
    const runTurn = vi.fn(async () => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(events.map(event => JSON.stringify(event)).join("\n") + "\n"));
        controller.close();
      },
    }));
    const fetcher = slackFetch();
    await enqueueSlackMention(db, mention);
    const sourceKey = alertKeys.slackMention(slackKey(mention.appId, mention.eventId));
    const resolve = vi.spyOn(db, "resolveAlertsByKey");
    expect(await runSlackMentionJobs({ db, fetcher, runTurn: runTurn as typeof streamConversationTurn }))
      .toEqual({ processed: 1, failed: 0 });
    expect(runTurn).toHaveBeenCalledWith(expect.objectContaining({ organizationId, connections }));
    expect(resolve).toHaveBeenCalledExactlyOnceWith(organizationId, sourceKey);
    const post = fetcher.mock.calls.find(([url]) => String(url).endsWith("chat.postMessage"))!;
    expect(JSON.parse(String(post[1]?.body)).text).toBe(
      "Ciele è una piattaforma per assistenti AI.\n\nSource — Ciele Docs: https://docs.ciele.app/",
    );
  });

  it("persists a sanitized runtime failure instead of hiding the provider error", async () => {
    await fixture();
    const encoder = new TextEncoder();
    const runTurn = vi.fn(() =>
      Promise.resolve(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `${JSON.stringify({ type: "error", message: "Google rejected AIzaSecretKey" })}\n`,
              ),
            );
            controller.close();
          },
        }),
      ),
    );
    await enqueueSlackMention(db, mention);

    expect(
      await runSlackMentionJobs({
        db,
        fetcher: slackFetch(),
        runTurn: runTurn as typeof streamConversationTurn,
      }),
    ).toEqual({ processed: 0, failed: 1 });

    const job = await db.createBackgroundJob({
      id: slackKey(mention.appId, mention.eventId),
      organizationId: (await resolveSlackConnection(db, mention))!
        .organizationId,
      kind: "answer_slack_mention",
      payload: {},
    });
    expect(job.error).toBe("Slack reply failed: Google rejected [redacted]");
  });

  it("runs the published runtime with thread context and replies once for retried events", async () => {
    const { organizationId, assistant } = await fixture();
    const fetcher = slackFetch();
    const runTurn = vi.fn(streamConversationTurn);
    await enqueueSlackMention(db, mention);
    await enqueueSlackMention(db, mention);
    expect(await runSlackMentionJobs({ db, fetcher, runTurn })).toEqual({
      processed: 1,
      failed: 0,
    });
    expect(runTurn).toHaveBeenCalledOnce();
    const input = runTurn.mock.calls[0][0];
    expect(input).toMatchObject({
      organizationId,
      assistant: { id: assistant.id },
      subjectType: "visitor",
      message: "hello",
    });
    expect(input.standingContext?.[0]).toContain("The deadline is Friday.");
    expect(input.standingContext?.[0]).toContain("untrusted reference data");
    const posts = fetcher.mock.calls.filter(([url]) =>
      String(url).endsWith("chat.postMessage"),
    );
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1]?.body))).toMatchObject({
      channel: mention.channel,
      thread_ts: mention.threadTs,
    });
    const infos = fetcher.mock.calls.filter(([url]) =>
      String(url).endsWith("conversations.info"),
    );
    expect(infos[0][1]?.headers).toMatchObject({
      "content-type": "application/x-www-form-urlencoded; charset=utf-8",
    });
    expect(new URLSearchParams(String(infos[0][1]?.body)).get("channel")).toBe(
      mention.channel,
    );
    await enqueueSlackMention(db, mention);
    await runSlackMentionJobs({ db, fetcher, runTurn });
    expect(runTurn).toHaveBeenCalledOnce();
  });

  it("does not respond after opt-out or in a shared channel", async () => {
    const { organizationId, connection } = await fixture();
    const fetcher = slackFetch({
      "conversations.info": {
        ok: true,
        channel: { id: mention.channel, is_member: true, is_ext_shared: true },
      },
    });
    const runTurn = vi.fn(streamConversationTurn);
    const resolve = vi.spyOn(db, "resolveAlertsByKey");
    await enqueueSlackMention(db, mention);
    await runSlackMentionJobs({ db, fetcher, runTurn });
    expect(runTurn).not.toHaveBeenCalled();
    const next = { ...mention, eventId: "EvNEXT" };
    await enqueueSlackMention(db, next);
    await saveSlackBotSettings(db, organizationId, connection.id, null);
    await runSlackMentionJobs({ db, fetcher, runTurn });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("checkpoints before delivery and never blindly reposts after an uncertain timeout", async () => {
    await fixture();
    const fetcher = slackFetch({
      "chat.postMessage": new Error("network timeout"),
    });
    const runTurn = vi.fn(streamConversationTurn);
    await enqueueSlackMention(db, mention);
    await runSlackMentionJobs({ db, fetcher, runTurn });
    const job = await db.createBackgroundJob({
      id: slackKey(mention.appId, mention.eventId),
      organizationId: (await resolveSlackConnection(db, mention))!
        .organizationId,
      kind: "answer_slack_mention",
      payload: {},
    });
    expect(job?.payload.deliveryAttempted).toBe(true);
    // Make the retry due without advancing model timers.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 120_000);
    await runSlackMentionJobs({ db, fetcher, runTurn });
    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).endsWith("conversations.info"),
      ),
    ).toHaveLength(2);
    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).endsWith("chat.postMessage"),
      ),
    ).toHaveLength(1);
    expect(runTurn).toHaveBeenCalledOnce();
  });

  it("makes rate-limited context explicit and never sends internal reasoning or Slack mentions", async () => {
    const context = await slackChannelContext(
      "test-token",
      mention,
      slackFetch({
        "conversations.history": new Error("rate limit"),
        "conversations.replies": new Error("rate limit"),
      }),
    );
    expect(context).toContain('"incomplete":true');
    expect(
      slackReply([
        {
          type: "text",
          text: "Hi <!channel> & <@UTEST>",
          action: "custom_message",
        },
        {
          type: "sources",
          action: "search_knowledge",
          sources: [
            {
              conceptTitle: "Policy",
              sourceName: null,
              collectionName: "Docs",
              url: "https://example.com/policy",
            },
          ],
        },
      ]),
    ).toBe(
      "Hi &lt;!channel&gt; &amp; &lt;@UTEST&gt;\n\nSource — Policy: https://example.com/policy",
    );
  });

  it("retries a known Slack 429 using the saved reply without rerunning the agent", async () => {
    await fixture();
    const fetcher = slackFetch({
      "chat.postMessage": new Response(null, {
        status: 429,
        headers: { "retry-after": "120" },
      }),
    });
    const runTurn = vi.fn(streamConversationTurn);
    await enqueueSlackMention(db, mention);
    await runSlackMentionJobs({ db, fetcher, runTurn });
    const job = await db.createBackgroundJob({
      id: slackKey(mention.appId, mention.eventId),
      organizationId: (await resolveSlackConnection(db, mention))!
        .organizationId,
      kind: "answer_slack_mention",
      payload: {},
    });
    expect(job.payload.deliveryAttempted).toBe(false);
    expect(job.payload.reply).toEqual(expect.any(String));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 121_000);
    const recovery = slackFetch();
    expect(
      await runSlackMentionJobs({ db, fetcher: recovery, runTurn }),
    ).toEqual({ processed: 1, failed: 0 });
    expect(
      recovery.mock.calls.filter(([url]) =>
        String(url).endsWith("chat.postMessage"),
      ),
    ).toHaveLength(1);
    expect(runTurn).toHaveBeenCalledOnce();
  });
});
