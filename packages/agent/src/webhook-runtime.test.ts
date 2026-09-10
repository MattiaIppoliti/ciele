import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./egress", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./egress")>()),
  egressFetch: vi.fn(),
}));

import type { WebhookSubscription } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { DEMO_ORG, getMockDb, resetMockDb } from "@agent-hub/db";
import { resetRuntimeHost } from "./host";
import { egressFetch } from "./egress";
import {
  deliverWebhookCallback,
  expireDueWebhooks,
  mintWebhookCallbackToken,
  resumeWebhookConversation,
  unsubscribePendingWebhooks,
  verifyWebhookCallbackToken,
  webhookCallbackUrl,
  webhookResumeVariables,
} from "./webhook-runtime";

/**
 * The callback gate's runtime (#842). The token is the whole authorization,
 * the caller being anonymous by construction, so most of this is about what a
 * URL is allowed to buy, and for how long.
 */

const egressFetchMock = vi.mocked(egressFetch);
const NOW = new Date("2026-09-09T12:00:00.000Z");

const subscription = (over: Partial<WebhookSubscription> = {}): WebhookSubscription => ({
  id: "wh1",
  organizationId: "org1",
  assistantId: "a1",
  conversationId: "c1",
  flowId: "f1",
  actionIndex: 1,
  status: "pending",
  subscribeMethod: "POST",
  subscribeUrl: "https://api.example.com/subscribe",
  unsubscribeMethod: null,
  unsubscribeUrl: null,
  unsubscribeBody: null,
  unsubscribedAt: null,
  payload: null,
  receivedAt: null,
  expiresAt: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
  haltMessage: "",
  simulated: false,
  resumedAt: null,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  ...over,
});

/**
 * A Db with just what the gate uses: the table accessor, the compare-and-set
 * that closes a row, and the Flow read the unsubscribe call takes its
 * credential from. `settle` can be made to lose, which is how the race with a
 * concurrent closer is reproduced without threads.
 */
function fakeDb(rows: WebhookSubscription[], options: { flow?: unknown } = {}) {
  const store = new Map(rows.map((row) => [row.id, row]));
  const jobs: { id: string; kind: string }[] = [];
  const settled: string[] = [];
  const db = {
    table: (name: string) => {
      if (name !== "webhookSubscriptions") throw new Error(`unexpected table ${name}`);
      return {
        get: async (id: string) => store.get(id) ?? null,
        list: async (filter: Partial<WebhookSubscription>) =>
          [...store.values()].filter((row) =>
            Object.entries(filter).every(([key, value]) => (row as never)[key] === value)
          ),
        update: async (id: string, patch: Partial<WebhookSubscription>) => {
          const next = { ...store.get(id)!, ...patch };
          store.set(id, next);
          return next;
        },
      };
    },
    settleWebhookSubscription: async (id: string, patch: Partial<WebhookSubscription>) => {
      const current = store.get(id);
      if (!current || current.status !== "pending") return null;
      const next = { ...current, ...patch };
      store.set(id, next);
      settled.push(id);
      return next;
    },
    getFlow: async () => options.flow ?? null,
    createBackgroundJob: async (job: { id: string; kind: string }) => {
      jobs.push(job);
      return job;
    },
  } as unknown as Db;
  return { db, store, jobs, settled };
}

beforeEach(() => {
  process.env.APP_ENCRYPTION_KEY = "test-key-for-webhook-signing";
  egressFetchMock.mockReset();
});

describe("the signed callback URL", () => {
  it("round-trips the subscription it names", () => {
    const token = mintWebhookCallbackToken(subscription());
    expect(verifyWebhookCallbackToken(token, { now: NOW })).toEqual({
      ok: true,
      subscriptionId: "wh1",
    });
  });

  it("refuses a token that was edited, truncated or invented", () => {
    const token = mintWebhookCallbackToken(subscription());
    const [payload, signature] = token.split(".");
    expect(verifyWebhookCallbackToken(`${payload}.${signature}x`, { now: NOW })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect(verifyWebhookCallbackToken(payload!, { now: NOW })).toMatchObject({ ok: false });
    expect(verifyWebhookCallbackToken("", { now: NOW })).toEqual({
      ok: false,
      reason: "malformed",
    });
    // A token for one subscription must not open another: the id is signed.
    const other = mintWebhookCallbackToken(subscription({ id: "wh2" }));
    expect(verifyWebhookCallbackToken(`${payload}.${other.split(".")[1]}`, { now: NOW })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("cannot outlive the wait it belonged to", () => {
    // The expiry is inside the signed material, so a URL that leaked out of the
    // other system's logs stops working on its own.
    const token = mintWebhookCallbackToken(subscription());
    const wayLater = new Date(NOW.getTime() + 48 * 3_600_000);
    expect(verifyWebhookCallbackToken(token, { now: wayLater })).toEqual({
      ok: false,
      reason: "expired",
    });
    // A little late still reads as "too late" rather than "bad link".
    const slightlyLate = new Date(NOW.getTime() + 20 * 60_000);
    expect(verifyWebhookCallbackToken(token, { now: slightlyLate })).toMatchObject({ ok: true });
  });

  it("says so rather than accepting anything when the signing key is absent", () => {
    const token = mintWebhookCallbackToken(subscription());
    delete process.env.APP_ENCRYPTION_KEY;
    expect(verifyWebhookCallbackToken(token, { now: NOW })).toEqual({
      ok: false,
      reason: "unconfigured",
    });
  });

  it("puts the token in a URL the other system can call", () => {
    const url = webhookCallbackUrl(subscription());
    expect(url).toContain("/api/webhooks/wh1");
    expect(url).toContain("?t=");
  });
});

describe("applying a callback", () => {
  it("records the body once and queues the continuation", async () => {
    const { db, store, jobs } = fakeDb([subscription()]);
    const first = await deliverWebhookCallback({ db, now: () => NOW }, "wh1", '{"state":"done"}');
    expect(first).toEqual({ ok: true, duplicate: false });
    expect(store.get("wh1")!.status).toBe("received");
    expect(store.get("wh1")!.payload).toBe('{"state":"done"}');
    expect(jobs).toEqual([
      expect.objectContaining({ kind: "resume_webhook_conversation", id: "resume_webhook_conversation:wh1" }),
    ]);
  });

  it("acknowledges a retry without continuing the Flow a second time", async () => {
    // At-least-once delivery is normal, and a caller told "conflict" retries
    // harder. What it must not get is a second run of the remaining actions.
    const { db, store, jobs } = fakeDb([subscription()]);
    await deliverWebhookCallback({ db, now: () => NOW }, "wh1", "first");
    const again = await deliverWebhookCallback({ db, now: () => NOW }, "wh1", "second");
    expect(again).toEqual({ ok: true, duplicate: true });
    expect(store.get("wh1")!.payload).toBe("first");
    expect(jobs).toHaveLength(1);
  });

  it("refuses a callback to a gate that already closed, or to nothing", async () => {
    const { db } = fakeDb([subscription({ status: "expired" })]);
    expect(await deliverWebhookCallback({ db }, "wh1", "{}")).toEqual({
      ok: false,
      reason: "closed",
    });
    expect(await deliverWebhookCallback({ db }, "nope", "{}")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("refuses a callback past the wait even when the sweep has not run yet", async () => {
    // The token still verifies for an hour past expiry (so the log can say
    // "late" rather than "forged"), but the row's own clock decides whether
    // anything happens. On the hosted plan the sweep is daily; without this a
    // fifteen-minute wait was a day.
    const { db, store, jobs } = fakeDb([subscription()]);
    const late = new Date(Date.parse(subscription().expiresAt) + 60_000);
    expect(await deliverWebhookCallback({ db, now: () => late }, "wh1", "{}")).toEqual({
      ok: false,
      reason: "closed",
    });
    expect(store.get("wh1")!.status).toBe("pending");
    expect(jobs).toEqual([]);
  });

  it("loses the race cleanly: a callback that passed the read but not the write is a duplicate", async () => {
    // Two callbacks in flight both read `pending`. The compare-and-set lets
    // one land; the other must read the row back and answer as what it is,
    // never overwrite the first body or queue a second continuation.
    const { db, store, jobs } = fakeDb([subscription()]);
    const original = db.settleWebhookSubscription.bind(db);
    let first = true;
    db.settleWebhookSubscription = async (id, patch) => {
      if (first) {
        first = false;
        // The other callback wins in between.
        await original(id, { status: "received", payload: "winner", receivedAt: NOW.toISOString() });
        return original(id, patch);
      }
      return original(id, patch);
    };
    expect(await deliverWebhookCallback({ db, now: () => NOW }, "wh1", "loser")).toEqual({
      ok: true,
      duplicate: true,
    });
    expect(store.get("wh1")!.payload).toBe("winner");
    expect(jobs).toEqual([]);
  });
});

describe("the clock", () => {
  it("expires what is overdue and queues its halt, leaving fresh gates alone", async () => {
    const overdue = subscription({
      id: "old",
      expiresAt: new Date(NOW.getTime() - 1).toISOString(),
    });
    const { db, store, jobs } = fakeDb([overdue, subscription({ id: "fresh" })]);
    const result = await expireDueWebhooks({ db, now: () => NOW });
    expect(result).toEqual({ expired: 1 });
    expect(store.get("old")!.status).toBe("expired");
    expect(store.get("fresh")!.status).toBe("pending");
    expect(jobs.map((job) => job.id)).toEqual(["resume_webhook_conversation:old"]);
  });

  it("does not flip a row a callback closed between its read and its write", async () => {
    const overdue = subscription({
      id: "old",
      expiresAt: new Date(NOW.getTime() - 1).toISOString(),
    });
    const { db, store, jobs } = fakeDb([overdue]);
    const list = db.table("webhookSubscriptions").list;
    db.table = ((_name: string) => ({
      ...fakeTable(store),
      list: async (...args: unknown[]) => {
        // The callback lands after the sweep listed the row as pending.
        const rows = await (list as (...a: unknown[]) => Promise<WebhookSubscription[]>)(...args);
        store.set("old", { ...store.get("old")!, status: "received", payload: "{}" });
        return rows;
      },
    })) as unknown as Db["table"];
    expect(await expireDueWebhooks({ db, now: () => NOW })).toEqual({ expired: 0 });
    expect(store.get("old")!.status).toBe("received");
    expect(jobs).toEqual([]);
  });

  it("closes pending gates and unsubscribes when a Conversation is deleted under them", async () => {
    // The migration cascades the row with the Conversation; this is the call
    // the ops layer makes first, so the other system is told to stop and a
    // callback racing the delete finds a closed gate.
    egressFetchMock.mockResolvedValue({
      response: { status: 204, ok: true, headers: new Headers(), text: "" },
      finalUrl: "https://api.example.com/subscriptions/9",
    } as never);
    const { db, store } = fakeDb(
      [
        subscription({ id: "a", unsubscribeMethod: "DELETE", unsubscribeUrl: "https://api.example.com/subscriptions/9" }),
        subscription({ id: "b", conversationId: "other" }),
        subscription({ id: "c", status: "received" }),
      ],
      {
        flow: {
          actionSettings: {
            http_webhook: {
              unsubscribe: { auth: { type: "bearer", token: "unsub-secret" } },
            },
          },
        },
      }
    );
    expect(await unsubscribePendingWebhooks({ db }, "c1")).toEqual({ cancelled: 1 });
    expect(store.get("a")!.status).toBe("expired");
    expect(store.get("a")!.unsubscribedAt).not.toBeNull();
    expect(store.get("b")!.status).toBe("pending");
    expect(store.get("c")!.status).toBe("received");
    // The credential comes from the Flow as it is now, never from the row.
    const [, init] = egressFetchMock.mock.calls[0]!;
    expect((init as { headers: Record<string, string> }).headers.authorization).toBe(
      "Bearer unsub-secret"
    );
  });
});

/** The plain table accessor over a store, for tests that wrap one method. */
function fakeTable(store: Map<string, WebhookSubscription>) {
  return {
    get: async (id: string) => store.get(id) ?? null,
    update: async (id: string, patch: Partial<WebhookSubscription>) => {
      const next = { ...store.get(id)!, ...patch };
      store.set(id, next);
      return next;
    },
  };
}

describe("what the actions after the gate read", () => {
  it("adds the settings' JSON paths to the core variables", () => {
    const received = subscription({ status: "received", payload: '{"data":{"id":"42"}}' });
    const vars = webhookResumeVariables(received, {
      jsonPaths: [{ id: "j1", path: "$.data.id", variable: "orderId" }],
    });
    expect(vars["webhook.received"]).toBe("true");
    expect(vars["orderId"]).toBe("42");
  });

  it("still offers the body when no paths are configured", () => {
    const received = subscription({ status: "received", payload: "raw" });
    expect(webhookResumeVariables(received, {})["webhook.body"]).toBe("raw");
  });
});

describe("callback continuation", () => {
  beforeEach(() => {
    resetMockDb();
    resetRuntimeHost();
  });

  it.each([false, true])("continues a received callback once (simulated: %s)", async (simulated) => {
    const db = getMockDb();
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Callback" });
    const flow = await db.createFlow(assistant.id, {
      name: "Callback",
      actions: ["http_webhook", "custom_message"],
      customMessage: "Received {{webhook.body}}.",
    });
    const conversation = await db.createConversation({
      assistantId: assistant.id,
      subjectType: "visitor",
      subjectId: "visitor-1",
      title: "Callback",
      metadata: {},
    });
    const gate = await db.table("webhookSubscriptions").insert(subscription({
      organizationId: DEMO_ORG.id,
      assistantId: assistant.id,
      conversationId: conversation.id,
      flowId: flow.id,
      actionIndex: 0,
      status: "received",
      payload: "done",
      simulated,
    }));
    await db.updateConversationMetadata(conversation.id, { pendingWebhookId: gate.id });

    await resumeWebhookConversation({ db, now: () => NOW }, gate.id);
    await resumeWebhookConversation({ db, now: () => NOW }, gate.id);

    const messages = await db.listMessages(conversation.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "assistant",
      content: expect.arrayContaining([expect.objectContaining({ type: "text", text: "Received done." })]),
    });
    expect((await db.table("webhookSubscriptions").get(gate.id))?.resumedAt).toBe(NOW.toISOString());
    expect((await db.getConversation(conversation.id))?.metadata.pendingWebhookId).toBeNull();
  });
});
