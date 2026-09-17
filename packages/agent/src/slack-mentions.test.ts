import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPublicationConfig, sealSecret } from "@agent-hub/core";
import { getMockDb, resetMockDb } from "@agent-hub/db";
import type {
  ApplicationHttpClient,
  ApplicationHttpResponse,
} from "./application-provider-http";
import { connectorAlertKey } from "./connector-request";
import { alertKeys } from "./health";
import {
  enqueueSlackMention,
  resolveSlackConnection,
  runDueSlackMentionJobs,
  slackChannelContext,
  slackFailureDetail,
  slackKey,
  slackReply,
  type SlackMention,
  type SlackMentionJobPayload,
} from "./slack-mentions";
import { streamConversationTurn } from "./turn";

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
const jobId = slackKey(mention.appId, mention.eventId);

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
  const assistant = await db.createAssistant(organizationId, { title: "Support" });
  await db.createPublication(
    assistant.id,
    buildPublicationConfig(assistant, await db.listFlows(assistant.id), [])
  );
  const connection = await db.createApplicationConnection({
    organizationId,
    provider: "slack",
    name: "Slack",
    sealedCredentials: sealSecret(JSON.stringify({ accessToken: "test-token", teamId })),
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

function json(body: unknown, status = 200, headers?: Record<string, string>): ApplicationHttpResponse {
  const text = JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, headers: new Headers(headers), text };
}

/** A Slack Web API fake keyed by method name; a value may be a body, a response or an Error. */
function slackClient(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; body: string; headers: Record<string, string> }> = [];
  const client = vi.fn<ApplicationHttpClient>(async (url, options) => {
    const method = url.split("/").at(-1)!;
    calls.push({ method, body: String(options.body ?? ""), headers: options.headers ?? {} });
    const override = overrides[method];
    if (override instanceof Error) throw override;
    if (override && typeof override === "object" && "status" in override && "text" in override) {
      return override as ApplicationHttpResponse;
    }
    return json(
      override ??
        (method === "conversations.info"
          ? { ok: true, channel: { id: mention.channel, is_member: true } }
          : method === "chat.postMessage"
            ? { ok: true, ts: "1770000003.000001" }
            : {
                ok: true,
                messages: [{ ts: "1770000001.000001", user: "UOTHER", text: "The deadline is Friday." }],
              })
    );
  });
  return Object.assign(client, {
    calls: (method: string) => calls.filter((call) => call.method === method),
  });
}

function turnStream(events: unknown[]) {
  return vi.fn(async () => {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(events.map((event) => JSON.stringify(event)).join("\n") + "\n")
        );
        controller.close();
      },
    });
  }) as unknown as typeof streamConversationTurn;
}

/** The ledger returns the existing row for a repeated stable id: that is the read. */
async function readJob(organizationId: string) {
  const job = await db.createBackgroundJob({
    id: jobId,
    organizationId,
    kind: "answer_slack_mention",
    payload: {},
  });
  return { ...job, payload: job.payload as unknown as SlackMentionJobPayload };
}

const activeAlerts = async (organizationId: string) =>
  (await db.listAlerts(organizationId)).filter((alert) => alert.status === "active");

describe("Slack mention routing", () => {
  it("routes by workspace, app and explicit channel opt-in, never by a default org", async () => {
    const { connection } = await fixture();
    expect((await resolveSlackConnection(db, mention))?.id).toBe(connection.id);
    expect(await resolveSlackConnection(db, { ...mention, teamId: "TOTHER" })).toBeNull();
    expect(await resolveSlackConnection(db, { ...mention, appId: "AOTHER" })).toBeNull();
    expect(await resolveSlackConnection(db, { ...mention, channel: "COTHER" })).toBeNull();
  });

  it("fails closed on a channel two Organizations claim, and tells both of them", async () => {
    const first = await fixture();
    const second = await fixture();
    const key = alertKeys.slackChannelConflict(mention.teamId, mention.channel);
    expect(await enqueueSlackMention(db, mention)).toBe(false);
    for (const org of [first, second]) {
      const [alert] = await activeAlerts(org.organizationId);
      expect(alert).toMatchObject({ sourceKey: key, type: "integration" });
      expect(alert.detail).toContain("2 Organizations");
    }
    // The second Organization gives the channel up. The next mention routes to
    // the first and clears the Alert on BOTH: the admin who removed the channel
    // is the one who fixed it, and cannot see the other row to check.
    await db.updateApplicationConnection(second.connection.id, {
      metadata: { slackAppId: mention.appId, slackBotUserId: "UBOT" },
    });
    expect(await enqueueSlackMention(db, mention)).toBe(true);
    expect(await activeAlerts(first.organizationId)).toEqual([]);
    expect(await activeAlerts(second.organizationId)).toEqual([]);
  });

  it("treats a conflict that appears after enqueue as a conflict, not an opt-out", async () => {
    const first = await fixture();
    await enqueueSlackMention(db, mention);
    const second = await fixture();
    expect(
      await runDueSlackMentionJobs({
        db,
        applicationHttpClient: slackClient(),
        runTurn: vi.fn(streamConversationTurn),
      })
    ).toMatchObject({ failed: 1 });
    const job = await readJob(first.organizationId);
    expect(job.payload.skipped).toBeUndefined();
    expect(job.error).toContain("more than one Organization");
    for (const org of [first, second]) {
      const keys = (await activeAlerts(org.organizationId)).map((alert) => alert.sourceKey);
      expect(keys).toContain(alertKeys.slackChannelConflict(mention.teamId, mention.channel));
    }
  });
});

describe("Slack mention worker", () => {
  it("delivers streamed model text with citations through the org provider connections", async () => {
    const { organizationId, assistant } = await fixture();
    const connections = await db.listProviderConnections(organizationId);
    const runTurn = turnStream([
      { type: "text-start", action: "search_knowledge" },
      { type: "text-delta", delta: "Ciele è " },
      { type: "text-delta", delta: "una piattaforma per assistenti AI." },
      { type: "text-end" },
      {
        type: "part",
        part: {
          type: "sources",
          action: "search_knowledge",
          sources: [
            { sourceName: "Ciele Docs", conceptTitle: "Overview", collectionName: "Docs", url: "https://docs.ciele.app/" },
          ],
        },
      },
      { type: "done", conversationId: "test", messageId: "reply" },
    ]);
    const client = slackClient();
    await enqueueSlackMention(db, mention);
    const resolve = vi.spyOn(db, "resolveAlertsByKey");
    expect(
      await runDueSlackMentionJobs({ db, applicationHttpClient: client, runTurn })
    ).toMatchObject({ claimed: 1, succeeded: 1, failed: 0 });
    expect(runTurn).toHaveBeenCalledWith(expect.objectContaining({ organizationId, connections }));
    expect(resolve).toHaveBeenCalledWith(organizationId, alertKeys.slackMention(jobId));
    const [post] = client.calls("chat.postMessage");
    expect(JSON.parse(post.body).text).toBe(
      "Ciele è una piattaforma per assistenti AI.\n\nSource: Ciele Docs: https://docs.ciele.app/"
    );
    // One Visitor per Slack user, one Conversation per (thread, user), marked as Slack.
    const conversation = (await db.listConversations(
      assistant.id,
      "visitor",
      slackKey(mention.teamId, mention.user)
    ))[0];
    expect(conversation?.metadata).toMatchObject({ origin: "slack" });
    expect(conversation?.subjectId).toBe(slackKey(mention.teamId, mention.user));
  });

  it("fences the channel transcript as untrusted and answers once for a redelivered event", async () => {
    const { organizationId, assistant } = await fixture();
    const client = slackClient();
    const runTurn = vi.fn(streamConversationTurn);
    await enqueueSlackMention(db, mention);
    await enqueueSlackMention(db, mention);
    expect(await runDueSlackMentionJobs({ db, applicationHttpClient: client, runTurn })).toMatchObject({
      claimed: 1,
      succeeded: 1,
    });
    expect(runTurn).toHaveBeenCalledOnce();
    const input = runTurn.mock.calls[0][0];
    expect(input).toMatchObject({
      organizationId,
      assistant: { id: assistant.id },
      subjectType: "visitor",
      message: "hello",
    });
    expect(input.untrustedContext?.[0]?.body).toContain("The deadline is Friday.");
    expect(input.standingContext?.join("\n")).not.toContain("The deadline is Friday.");
    expect(client.calls("chat.postMessage")).toHaveLength(1);
    expect(JSON.parse(client.calls("chat.postMessage")[0].body)).toMatchObject({
      channel: mention.channel,
      thread_ts: mention.threadTs,
    });
    const [info] = client.calls("conversations.info");
    expect(info.headers["content-type"]).toContain("application/x-www-form-urlencoded");
    expect(new URLSearchParams(info.body).get("channel")).toBe(mention.channel);
    await enqueueSlackMention(db, mention);
    await runDueSlackMentionJobs({ db, applicationHttpClient: client, runTurn });
    expect(runTurn).toHaveBeenCalledOnce();
  });

  it("records a sanitized runtime failure on the job and retries it", async () => {
    const { organizationId } = await fixture();
    const runTurn = turnStream([{ type: "error", message: "Google rejected AIzaSecretKey" }]);
    await enqueueSlackMention(db, mention);
    expect(
      await runDueSlackMentionJobs({ db, applicationHttpClient: slackClient(), runTurn })
    ).toMatchObject({ claimed: 1, retried: 1 });
    const job = await readJob(organizationId);
    expect(job.status).toBe("queued");
    expect(job.error).toBe("Google rejected [redacted]");
    expect(slackFailureDetail({ message: "PostgREST said no" })).toBe("PostgREST said no");
  });

  it("records why a mention was skipped instead of settling a silent success", async () => {
    const { organizationId, connection } = await fixture();
    const client = slackClient();
    const runTurn = vi.fn(streamConversationTurn);
    await enqueueSlackMention(db, mention);
    await db.updateApplicationConnection(connection.id, {
      metadata: { slackAppId: mention.appId, slackBotUserId: "UBOT", teamName: "Test" },
    });
    expect(await runDueSlackMentionJobs({ db, applicationHttpClient: client, runTurn })).toMatchObject({
      succeeded: 1,
    });
    expect(runTurn).not.toHaveBeenCalled();
    expect(client).not.toHaveBeenCalled();
    expect((await readJob(organizationId)).payload.skipped).toBe("replies_disabled");
    expect(await activeAlerts(organizationId)).toEqual([]);
  });

  it("fails a mention in a channel the bot cannot answer in, and raises the Alert", async () => {
    const { organizationId } = await fixture();
    const runTurn = vi.fn(streamConversationTurn);
    for (const [channel, reason] of [
      [{ id: mention.channel, is_member: false }, "not a member"],
      [{ id: mention.channel, is_member: true, is_ext_shared: true }, "Slack Connect"],
    ] as const) {
      resetMockDb();
      const { organizationId: org } = await fixture();
      const client = slackClient({ "conversations.info": { ok: true, channel } });
      await enqueueSlackMention(db, mention);
      expect(await runDueSlackMentionJobs({ db, applicationHttpClient: client, runTurn })).toMatchObject({
        failed: 1,
      });
      const [alert] = await activeAlerts(org);
      expect(alert.sourceKey).toBe(alertKeys.slackMention(jobId));
      expect(alert.detail).toContain(reason);
    }
    expect(runTurn).not.toHaveBeenCalled();
    void organizationId;
  });

  it("never reposts after an uncertain timeout, and says so once", async () => {
    const { organizationId } = await fixture();
    const client = slackClient({ "chat.postMessage": new Error("network timeout") });
    const runTurn = vi.fn(streamConversationTurn);
    await enqueueSlackMention(db, mention);
    expect(await runDueSlackMentionJobs({ db, applicationHttpClient: client, runTurn })).toMatchObject({
      retried: 1,
    });
    expect((await readJob(organizationId)).payload.deliveryAttempted).toBe(true);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 120_000);
    const recovery = slackClient();
    expect(
      await runDueSlackMentionJobs({ db, applicationHttpClient: recovery, runTurn })
    ).toMatchObject({ failed: 1 });
    expect(recovery).not.toHaveBeenCalled();
    expect(runTurn).toHaveBeenCalledOnce();
    const [alert] = await activeAlerts(organizationId);
    expect(alert.detail).toContain("outcome unknown");
  });

  it("never reposts when a 2xx body did not parse, because delivery is unknown", async () => {
    const { organizationId } = await fixture();
    const client = slackClient({
      "chat.postMessage": {
        status: 200,
        ok: true,
        headers: new Headers(),
        text: "<html>gateway</html>",
      },
    });
    await enqueueSlackMention(db, mention);
    expect(
      await runDueSlackMentionJobs({ db, applicationHttpClient: client, runTurn: vi.fn(streamConversationTurn) })
    ).toMatchObject({ retried: 1 });
    expect((await readJob(organizationId)).payload.deliveryAttempted).toBe(true);
  });

  it("refuses a token minted for another workspace", async () => {
    const { organizationId, connection } = await fixture();
    await enqueueSlackMention(db, mention);
    await db.updateApplicationConnection(connection.id, {
      sealedCredentials: sealSecret(JSON.stringify({ accessToken: "t" })),
    });
    const client = slackClient();
    expect(
      await runDueSlackMentionJobs({ db, applicationHttpClient: client, runTurn: vi.fn(streamConversationTurn) })
    ).toMatchObject({ failed: 1 });
    expect(client).not.toHaveBeenCalled();
    expect((await readJob(organizationId)).error).toContain("workspace mismatch");
  });

  it("redacts a credential out of the error the ledger persists", async () => {
    const { organizationId } = await fixture();
    const runTurn = turnStream([
      { type: "error", message: "Provider rejected Bearer xoxb-secret-token" },
    ]);
    await enqueueSlackMention(db, mention);
    await runDueSlackMentionJobs({ db, applicationHttpClient: slackClient(), runTurn });
    const job = await readJob(organizationId);
    expect(job.error).toBe("Provider rejected Bearer [redacted]");
    expect(job.error).not.toContain("xoxb-secret-token");
  });

  it("drops a reply Slack refused for good, with the refusal as the reason", async () => {
    const { organizationId } = await fixture();
    const client = slackClient({ "chat.postMessage": { ok: false, error: "channel_not_found" } });
    await enqueueSlackMention(db, mention);
    expect(
      await runDueSlackMentionJobs({ db, applicationHttpClient: client, runTurn: vi.fn(streamConversationTurn) })
    ).toMatchObject({ failed: 1 });
    const job = await readJob(organizationId);
    expect(job.payload.deliveryAttempted).toBe(false);
    expect(job.error).toContain("channel_not_found");
    expect((await activeAlerts(organizationId))[0].detail).toContain("channel_not_found");
  });

  it("retries a known Slack 429 with the saved reply and without rerunning the agent", async () => {
    const { organizationId } = await fixture();
    const client = slackClient({
      "chat.postMessage": json(null, 429, { "retry-after": "120" }),
    });
    const runTurn = vi.fn(streamConversationTurn);
    await enqueueSlackMention(db, mention);
    await runDueSlackMentionJobs({ db, applicationHttpClient: client, runTurn });
    const job = await readJob(organizationId);
    expect(job.payload.deliveryAttempted).toBe(false);
    expect(job.payload.reply).toEqual(expect.any(String));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 121_000);
    const recovery = slackClient();
    expect(
      await runDueSlackMentionJobs({ db, applicationHttpClient: recovery, runTurn })
    ).toMatchObject({ succeeded: 1 });
    expect(recovery.calls("chat.postMessage")).toHaveLength(1);
    expect(recovery.calls("conversations.info")).toHaveLength(0);
    expect(runTurn).toHaveBeenCalledOnce();
  });

  it("marks the connection for reconnect on a revoked token", async () => {
    const { organizationId, connection } = await fixture();
    const client = slackClient({ "conversations.info": { ok: false, error: "token_revoked" } });
    await enqueueSlackMention(db, mention);
    expect(
      await runDueSlackMentionJobs({ db, applicationHttpClient: client, runTurn: vi.fn(streamConversationTurn) })
    ).toMatchObject({ failed: 1 });
    expect((await db.getSafeApplicationConnection(connection.id))?.status).toBe(
      "reauthorization_required"
    );
    const keys = (await activeAlerts(organizationId)).map((alert) => alert.sourceKey).sort();
    expect(keys).toEqual([connectorAlertKey(connection.id), alertKeys.slackMention(jobId)].sort());
  });

  it("stops starting jobs once the host budget cannot fit another full one", async () => {
    await fixture();
    const runTurn = vi.fn(streamConversationTurn);
    await enqueueSlackMention(db, mention);
    await enqueueSlackMention(db, { ...mention, eventId: "EvSECOND", ts: "1770000004.000001" });
    let clock = 0;
    const result = await runDueSlackMentionJobs(
      { db, applicationHttpClient: slackClient(), runTurn },
      { budgetMs: 300_000, now: () => (clock += 100_000) }
    );
    expect(result.claimed).toBe(1);
    expect(runTurn).toHaveBeenCalledOnce();
  });

  it("marks rate-limited context as partial and escapes Slack control sequences", async () => {
    const context = await slackChannelContext(
      slackClient({
        "conversations.history": new Error("rate limit"),
        "conversations.replies": new Error("rate limit"),
      }),
      "test-token",
      mention
    );
    expect(context.incomplete).toBe(true);
    expect(context.transcript).toContain('"incomplete":true');
    expect(
      slackReply([
        { type: "text", text: "Hi <!channel> & <@UTEST>", action: "custom_message" },
        {
          type: "sources",
          action: "search_knowledge",
          sources: [
            { conceptTitle: "Policy", sourceName: null, collectionName: "Docs", url: "https://example.com/policy" },
          ],
        },
      ])
    ).toBe("Hi &lt;!channel&gt; &amp; &lt;@UTEST&gt;\n\nSource: Policy: https://example.com/policy");
  });
});
