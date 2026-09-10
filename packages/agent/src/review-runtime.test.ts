import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Flow, ReviewRequest } from "@agent-hub/core";
import { sealSecret } from "@agent-hub/core";
import { DEMO_ORG, getMockDb, resetMockDb } from "@agent-hub/db";
import { resetRuntimeHost } from "./host";
import type { Db } from "@agent-hub/db";
import type { ApplicationHttpClient, ApplicationHttpResponse } from "./application-provider-http";
import { ACTION_HANDLERS } from "./actions";
import {
  DELIVER_REVIEW_KIND,
  RESUME_REVIEW_KIND,
  dbReviewRuntime,
  deliverReviewRequest,
  expireDueReviews,
  mintReviewLinkToken,
  resumeReviewedConversation,
  reviewLinkUrl,
  reviewPart,
  verifyReviewLinkToken,
} from "./review-runtime";
import type { ActionContext, ReviewRuntime } from "./types";

process.env.APP_ENCRYPTION_KEY ??= "review-test-key";

const NOW = new Date("2026-09-09T10:00:00Z");

/**
 * NOW is the review domain's clock: expiries, decision times, link validity.
 * A job row's `nextRunAt` is not on it, the ledger stamps that from the wall
 * clock, so a claim has to be made at a wall-clock-or-later instant or nothing
 * is ever due. Keeping the two apart is what stops these tests expiring on the
 * day NOW names.
 */
const claimAt = (): string => new Date(Date.now() + 60_000).toISOString();

function response(status: number, body: unknown = {}): ApplicationHttpResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    text: typeof body === "string" ? body : JSON.stringify(body),
  };
}

async function seed(db: Db, over: Partial<ReviewRequest> = {}) {
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Gate" });
  const flow = await db.createFlow(assistant.id, {
    name: "Refunds",
    actions: ["human_review", "custom_message"],
    customMessage: "Approved by {{review.decidedBy}} for {{review.amount}}.",
    actionSettings: {
      human_review: {
        title: "Approve a refund",
        assignees: ["ann@campus.edu"],
        channel: "email",
        senderConnectionId: "mail-1",
        inputs: [{ id: "amount", label: "Amount", type: "short_text" }],
      },
    },
  });
  const conversation = await db.createConversation({
    assistantId: assistant.id,
    subjectType: "visitor",
    subjectId: "visitor-1",
    title: "Refund",
    metadata: {},
  });
  const review = await db.table("reviewRequests").insert({
    organizationId: DEMO_ORG.id,
    assistantId: assistant.id,
    conversationId: conversation.id,
    flowId: flow.id,
    actionIndex: 0,
    title: "Approve a refund",
    message: "Please decide.",
    summary: "Visitor: refund please",
    channel: "email",
    assignees: ["ann@campus.edu"],
    inputs: [{ id: "amount", label: "Amount", type: "short_text" }],
    expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
    haltMessage: "",
    simulated: false,
    ...over,
  });
  return { assistant, flow, conversation, review };
}

beforeEach(() => {
  resetMockDb();
  // And the runtime host, which is a module singleton (`host.ts`). Raising a
  // request queues a delivery job *and* asks the host to drain it after the
  // response; the default host drops that work, which is what lets the two
  // assertions below read the ledger. A host another test file registered and
  // did not reset would drain the job first, and this file would fail
  // depending only on which tests share its worker.
  resetRuntimeHost();
});

describe("signed links", () => {
  it("round-trips and binds the review id and expiry", () => {
    const review = { id: "rev_1", expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString() };
    const token = mintReviewLinkToken(review);
    expect(verifyReviewLinkToken(token, { now: NOW })).toEqual({ ok: true, reviewId: "rev_1" });
    expect(reviewLinkUrl(review)).toContain(`/reviews/rev_1?t=${token}`);
    expect(verifyReviewLinkToken(`${token}x`, { now: NOW })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyReviewLinkToken("nonsense", { now: NOW })).toEqual({ ok: false, reason: "malformed" });
    expect(
      verifyReviewLinkToken(token, { now: new Date(NOW.getTime() + 30 * 24 * 3_600_000) })
    ).toEqual({ ok: false, reason: "expired" });
  });
});

describe("the human_review action", () => {
  const ctx = (runtime: ReviewRuntime | undefined, flow: Flow): ActionContext =>
    ({
      assistant: { id: flow.assistantId, title: "Gate" },
      platformPrompt: "",
      flow,
      message: "refund please",
      history: [{ role: "assistant", text: "Hi" }],
      templateContext: {},
      chatModel: null,
      session: { get: () => undefined, set: () => undefined, snapshot: () => ({}) },
      skills: [],
      priorParts: [],
      emit: () => undefined,
      reviewRuntime: runtime,
      actionIndex: 0,
      previewSurface: true,
    }) as unknown as ActionContext;

  it("raises a request through the port, tells the Visitor, and halts", async () => {
    const db = getMockDb();
    const { flow } = await seed(db);
    const created: unknown[] = [];
    const runtime: ReviewRuntime = {
      simulated: true,
      conversationId: "c1",
      create: async (input) => {
        created.push(input);
        return { ...(input as ReviewRequest), id: "rev_x", status: "pending", simulated: true } as ReviewRequest;
      },
    };
    const result = await ACTION_HANDLERS.human_review(ctx(runtime, flow));
    expect(result.halt).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      flowId: flow.id,
      actionIndex: 0,
      title: "Approve a refund",
      assignees: ["ann@campus.edu"],
      summary: "Assistant: Hi\nVisitor: refund please",
    });
    expect(result.parts.map((part) => part.type)).toEqual(["text", "human_review"]);
    expect(result.parts[1]).toMatchObject({ reviewId: "rev_x", status: "pending", simulated: true });
  });

  it("halts with a diagnostic when the settings are incomplete or the surface has no port", async () => {
    const db = getMockDb();
    const { flow } = await seed(db);
    const broken = { ...flow, actionSettings: { human_review: { title: "" } } };
    const result = await ACTION_HANDLERS.human_review(ctx(undefined, broken));
    expect(result.halt).toBe(true);
    expect(result.parts[0]).toMatchObject({ action: "fallback" });
    const noPort = await ACTION_HANDLERS.human_review(ctx(undefined, flow));
    expect(noPort.parts[0]).toMatchObject({ text: expect.stringMatching(/not available/) });
  });

  it("the Db port inserts the row, marks the conversation waiting, and queues delivery unless simulated", async () => {
    const db = getMockDb();
    const { assistant, conversation } = await seed(db);
    const live = dbReviewRuntime(db, { conversation, assistant, simulated: false });
    const review = await live.create({
      flowId: "f",
      actionIndex: 0,
      title: "T",
      message: "",
      summary: "",
      channel: "email",
      assignees: ["ann@campus.edu"],
      inputs: [],
      expiresAt: new Date(NOW.getTime() + 1000).toISOString(),
      haltMessage: "",
    });
    expect((await db.getConversation(conversation.id))?.metadata.pendingReviewId).toBe(review.id);
    const jobs = await db.claimBackgroundJobs({
      kind: DELIVER_REVIEW_KIND,
      workerId: "t",
      now: claimAt(),
      staleBefore: claimAt(),
      limit: 5,
    });
    expect(jobs.map((job) => job.payload.reviewId)).toEqual([review.id]);

    const simulated = dbReviewRuntime(db, { conversation, assistant, simulated: true });
    await simulated.create({
      flowId: "f",
      actionIndex: 0,
      title: "T",
      message: "",
      summary: "",
      channel: "email",
      assignees: [],
      inputs: [],
      expiresAt: new Date(NOW.getTime() + 1000).toISOString(),
      haltMessage: "",
    });
    // The first claim still holds its lease, so only a *new* row would show.
    const more = await db.claimBackgroundJobs({
      kind: DELIVER_REVIEW_KIND,
      workerId: "t",
      now: claimAt(),
      staleBefore: new Date(Date.parse(claimAt()) - 120_000).toISOString(),
      limit: 5,
    });
    expect(more).toEqual([]);
  });
});

describe("delivery", () => {
  it("sends the email through the sender mailbox with the signed link, and marks a revoked mailbox broken", async () => {
    const db = getMockDb();
    const { review } = await seed(db);
    const sender = await db.createApplicationConnection({
      organizationId: DEMO_ORG.id,
      ownerMemberId: "u-ann",
      provider: "microsoft_mail",
      name: "ann@campus.edu",
      sealedCredentials: sealSecret(JSON.stringify({ accessToken: "tok", expiresAt: "2099-01-01T00:00:00Z" })),
      scopes: ["Mail.Send"],
    });
    const calls: { url: string; body: unknown }[] = [];
    const client: ApplicationHttpClient = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body ?? "{}") });
      return response(202, "");
    };
    await deliverReviewRequest(review, { senderConnectionId: sender.id }, { db, client });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    const body = calls[0]!.body as { message: { subject: string; body: { content: string }; toRecipients: { emailAddress: { address: string } }[] } };
    expect(body.message.subject).toBe("[Review] Approve a refund");
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: "ann@campus.edu" } }]);
    expect(body.message.body.content).toContain(`/reviews/${review.id}?t=`);
    expect(body.message.body.content).toContain("Visitor: refund please");

    const revoked: ApplicationHttpClient = async () => response(401, "");
    await expect(
      deliverReviewRequest(review, { senderConnectionId: sender.id }, { db, client: revoked })
    ).rejects.toMatchObject({ retryable: false });
    expect((await db.getApplicationConnection(sender.id))?.status).toBe("reauthorization_required");
  });

  it("posts to Slack through the organization's bot and refuses without one", async () => {
    const db = getMockDb();
    const { review } = await seed(db, { channel: "slack" });
    // The demo data ships a connected Slack row with placeholder credentials;
    // take it out of the running so the one created below is the bot.
    for (const existing of await db.listApplicationConnections(DEMO_ORG.id)) {
      if (existing.provider === "slack") {
        await db.updateApplicationConnection(existing.id, { status: "error" });
      }
    }
    await expect(
      deliverReviewRequest(review, { slackTarget: "C1" }, { db, client: async () => response(200) })
    ).rejects.toMatchObject({ retryable: false, message: /No Slack connection/ });
    const bot = await db.createApplicationConnection({
      organizationId: DEMO_ORG.id,
      provider: "slack",
      name: "Campus Slack",
      sealedCredentials: sealSecret(JSON.stringify({ accessToken: "xoxb", expiresAt: "2099-01-01T00:00:00Z" })),
      scopes: ["chat:write"],
    });
    await db.updateApplicationConnection(bot.id, { status: "connected" });
    const calls: { url: string; body: unknown }[] = [];
    await deliverReviewRequest(review, { slackTarget: "C1" }, {
      db,
      client: async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body ?? "{}") });
        return response(200, { ok: true });
      },
    });
    expect(calls[0]!.url).toBe("https://slack.com/api/chat.postMessage");
    expect(calls[0]!.body).toMatchObject({ channel: "C1" });
  });
});

describe("the clock and the continuation", () => {
  it("expires overdue requests and queues their halt, leaving fresh ones alone", async () => {
    const db = getMockDb();
    const { review: fresh } = await seed(db);
    const { review: overdue } = await seed(db, {
      expiresAt: new Date(NOW.getTime() - 1000).toISOString(),
    });
    const result = await expireDueReviews({ db, now: () => NOW });
    expect(result).toEqual({ expired: 1 });
    expect((await db.table("reviewRequests").get(overdue.id))?.status).toBe("expired");
    expect((await db.table("reviewRequests").get(fresh.id))?.status).toBe("pending");
    const jobs = await db.claimBackgroundJobs({
      kind: RESUME_REVIEW_KIND,
      workerId: "t",
      now: claimAt(),
      staleBefore: claimAt(),
      limit: 5,
    });
    expect(jobs.map((job) => job.payload.reviewId)).toEqual([overdue.id]);
  });

  it("does not overwrite a decision that landed while the sweep was deciding", async () => {
    // The sweep lists pending rows, then writes. A Member who approved in
    // between has closed the row; the sweep's write is a compare-and-set that
    // finds nothing pending, so the approval stands and its continuation is
    // the one that runs.
    const db = getMockDb();
    const { review } = await seed(db, {
      expiresAt: new Date(NOW.getTime() - 1000).toISOString(),
    });
    const list = db.table.bind(db);
    db.table = ((name: Parameters<Db["table"]>[0]) => {
      const accessor = list(name);
      if (name !== "reviewRequests") return accessor;
      return {
        ...accessor,
        list: async (...args: Parameters<typeof accessor.list>) => {
          const rows = await accessor.list(...args);
          await db.decideReviewRequest(review.id, {
            status: "approved",
            decision: { amount: "5" },
            decidedBy: "u-ann",
            decidedByName: "Ann",
            decidedAt: NOW.toISOString(),
          });
          return rows;
        },
      };
    }) as Db["table"];
    expect(await expireDueReviews({ db, now: () => NOW })).toEqual({ expired: 0 });
    expect((await db.table("reviewRequests").get(review.id))?.status).toBe("approved");
  });

  it("a rejection persists the halt message with the closed card once, and clears the waiting marker", async () => {
    const db = getMockDb();
    const { review, conversation } = await seed(db);
    await db.updateConversationMetadata(conversation.id, { pendingReviewId: review.id });
    await db.decideReviewRequest(review.id, {
      status: "rejected",
      decision: {},
      decidedBy: "u-ann",
      decidedByName: "ann@campus.edu",
      decidedAt: NOW.toISOString(),
    });
    const first = await resumeReviewedConversation({ db, now: () => NOW }, review.id);
    expect(first?.content).toEqual([
      expect.objectContaining({ type: "human_review", status: "rejected", decidedByName: null }),
      expect.objectContaining({ type: "text", text: expect.stringMatching(/not approved/) }),
    ]);
    expect((await db.getConversation(conversation.id))?.metadata.pendingReviewId).toBeNull();
    expect((await db.table("reviewRequests").get(review.id))?.resumedAt).toBe(NOW.toISOString());
    // A retried job replays the same message rather than writing a second one.
    const again = await resumeReviewedConversation({ db, now: () => NOW }, review.id);
    expect(again?.messageId).toBe(first?.messageId);
    expect((await db.listMessages(conversation.id)).filter((m) => m.role === "assistant")).toHaveLength(1);
  });

  it("an approval runs the rest of the Flow with the reviewer's inputs and no Visitor message", async () => {
    const db = getMockDb();
    const { review, conversation } = await seed(db);
    await db.decideReviewRequest(review.id, {
      status: "approved",
      decision: { amount: "50" },
      decidedBy: "u-ann",
      decidedByName: "Ann",
      decidedAt: NOW.toISOString(),
    });
    const resumed = await resumeReviewedConversation({ db, now: () => NOW }, review.id);
    const texts = (resumed?.content ?? []).flatMap((part) =>
      part.type === "text" ? [part.text] : []
    );
    expect(texts).toContain("Approved by Ann for 50.");
    expect(resumed?.content[0]).toMatchObject({ type: "human_review", status: "approved" });
    const messages = await db.listMessages(conversation.id);
    expect(messages.filter((m) => m.role === "user")).toHaveLength(0);
    expect(messages.filter((m) => m.role === "assistant")).toHaveLength(1);
  });

  it("keeps a Member's name out of a Visitor-facing card", () => {
    const base = {
      id: "r",
      title: "T",
      status: "approved",
      decidedByName: "ann@campus.edu",
    } as ReviewRequest;
    expect(reviewPart({ ...base, simulated: false }).decidedByName).toBeNull();
    expect(reviewPart({ ...base, simulated: true }).decidedByName).toBe("ann@campus.edu");
  });
});

vi.mock("./host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./host")>();
  return {
    ...actual,
    getRuntimeHost: () => ({
      ...actual.getRuntimeHost(),
      // Never run the after-response drain inside a test: the ledger rows are
      // what the assertions read.
      scheduleAfterResponse: () => undefined,
    }),
  };
});
