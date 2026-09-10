import { describe, expect, it } from "vitest";
import type { Flow, ReviewRequest, Role } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, createOrgPinnedDb, getMockDb } from "@agent-hub/db";
import type { Db } from "@agent-hub/db";
import { createAssistantOp } from "./assistants";
import { createFlowOp } from "./flows";
import { OperationError, type OperationContext } from "./operation";
import {
  assertHumanReviewFlowsPublishable,
  decideReviewOp,
  getReviewOp,
  listReviewsOp,
} from "./reviews";

const ctx = (db: Db, over: Partial<OperationContext> = {}): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "editor" as Role,
  actorEmail: DEMO_MEMBER.email,
  actorName: "Demo Member",
  db,
  ...over,
});

async function seedReview(db: Db, over: Partial<ReviewRequest> = {}) {
  const assistant = await createAssistantOp.run(ctx(db), { title: "Gate" });
  const flow = await createFlowOp.run(ctx(db), {
    assistantId: assistant.id,
    input: { name: "Refunds", actions: ["human_review", "custom_message"] },
  });
  const conversation = await db.createConversation({
    assistantId: assistant.id,
    subjectType: "visitor",
    subjectId: "visitor-1",
    title: "Refund please",
  });
  const review = await db.table("reviewRequests").insert({
    organizationId: DEMO_ORG.id,
    assistantId: assistant.id,
    conversationId: conversation.id,
    flowId: flow.id,
    actionIndex: 0,
    title: "Approve refund",
    message: "",
    summary: "Visitor: refund please",
    channel: "email",
    assignees: [DEMO_MEMBER.email.toLowerCase()],
    inputs: [{ id: "amount", label: "Amount", type: "short_text", required: true }],
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    haltMessage: "",
    simulated: false,
    ...over,
  });
  return { assistant, flow, conversation, review };
}

describe("reviews.list / reviews.get", () => {
  it("lists the Organization's requests, filtered, on the pinned Db too", async () => {
    const inner = getMockDb();
    const { review, conversation } = await seedReview(inner);
    const pinned = createOrgPinnedDb(inner, DEMO_ORG.id);
    const all = await listReviewsOp.run(ctx(pinned), {});
    expect(all.map((r) => r.id)).toContain(review.id);
    expect(await listReviewsOp.run(ctx(pinned), { status: "approved" })).toEqual([]);
    expect(
      (await listReviewsOp.run(ctx(pinned), { conversationId: conversation.id })).map((r) => r.id)
    ).toEqual([review.id]);
    expect((await getReviewOp.run(ctx(pinned), { id: review.id })).title).toBe("Approve refund");
    await expect(
      getReviewOp.run(ctx(pinned, { organizationId: "other" }), { id: review.id })
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("reviews.decide", () => {
  it("an assignee approves once, with inputs, and the host continuation port is told", async () => {
    const db = getMockDb();
    const { review } = await seedReview(db);
    const seen: string[] = [];
    const result = await decideReviewOp.run(
      ctx(db, {
        ports: {
          afterReviewDecided: async (decided) => {
            seen.push(decided.status);
            return { messageId: "m1", content: [] };
          },
        },
      }),
      { id: review.id, decision: "approved", inputs: { amount: "50" } }
    );
    expect(result.review).toMatchObject({
      status: "approved",
      decision: { amount: "50" },
      decidedBy: DEMO_MEMBER.userId,
      decidedByName: "Demo Member",
    });
    expect(result.resumed).toEqual({ messageId: "m1", content: [] });
    expect(seen).toEqual(["approved"]);

    await expect(
      decideReviewOp.run(ctx(db), { id: review.id, decision: "rejected", inputs: {} })
    ).rejects.toMatchObject({ code: "conflict", message: /Demo Member/ });
  });

  it("refuses a non-assignee Member, allows an admin, and needs the required input", async () => {
    const db = getMockDb();
    const { review } = await seedReview(db, { assignees: ["someone.else@campus.edu"] });
    await expect(
      decideReviewOp.run(ctx(db), { id: review.id, decision: "approved", inputs: { amount: "1" } })
    ).rejects.toMatchObject({ code: "conflict", message: /assignee/ });
    await expect(
      decideReviewOp.run(ctx(db, { role: "admin" }), { id: review.id, decision: "approved", inputs: {} })
    ).rejects.toMatchObject({ code: "invalid_input", message: /amount/ });
    const result = await decideReviewOp.run(ctx(db, { role: "admin" }), {
      id: review.id,
      decision: "rejected",
      inputs: {},
    });
    expect(result.review.status).toBe("rejected");
  });

  it("an API key with no email decides only through the admin override", async () => {
    const db = getMockDb();
    const { review } = await seedReview(db);
    await expect(
      decideReviewOp.run(ctx(db, { actorEmail: undefined, actorName: null, role: "editor" }), {
        id: review.id,
        decision: "rejected",
        inputs: {},
      })
    ).rejects.toMatchObject({ code: "conflict", message: /assignee/ });
    const result = await decideReviewOp.run(ctx(db, { actorEmail: undefined, actorName: null, role: "owner" }), {
      id: review.id,
      decision: "rejected",
      inputs: {},
    });
    expect(result.review.decidedByName).toBe("");
  });

  it("runs on the pinned Db an API key holds, and loses a race honestly", async () => {
    const inner = getMockDb();
    const { review } = await seedReview(inner);
    const pinned = createOrgPinnedDb(inner, DEMO_ORG.id);
    // Somebody else closed it between our read and our write.
    const racing = ctx(pinned, {
      ports: {
        decideReviewRequest: async () => null,
      },
    });
    await expect(
      decideReviewOp.run(racing, { id: review.id, decision: "approved", inputs: { amount: "1" } })
    ).rejects.toMatchObject({ code: "conflict" });
    const result = await decideReviewOp.run(ctx(pinned), {
      id: review.id,
      decision: "approved",
      inputs: { amount: "1" },
    });
    expect(result.review.status).toBe("approved");
  });

  it("an overdue request cannot be decided", async () => {
    const db = getMockDb();
    const { review } = await seedReview(db, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await expect(
      decideReviewOp.run(ctx(db), { id: review.id, decision: "approved", inputs: { amount: "1" } })
    ).rejects.toMatchObject({ code: "conflict", message: /expired/ });
  });
});

describe("assertHumanReviewFlowsPublishable", () => {
  const flow = (over: Partial<Flow>): Flow => ({
    id: "f",
    assistantId: "a",
    name: "Refunds",
    description: "",
    builtIn: false,
    enabled: true,
    position: 1,
    trigger: "message",
    triggerSettings: {},
    conditionLogic: "any",
    conditions: [],
    actions: ["human_review"],
    actionSettings: {},
    customMessage: "",
    isDefault: false,
    ...over,
  });
  const settings = {
    title: "Approve",
    assignees: [DEMO_MEMBER.email],
    channel: "email" as const,
    senderConnectionId: "conn-mail",
    inputs: [{ id: "amount", label: "Amount", type: "short_text" as const }],
  };

  it("passes with a Member assignee and a connected mailbox, and ignores disabled flows", async () => {
    const db = getMockDb();
    const sender = await db.createApplicationConnection({
      organizationId: DEMO_ORG.id,
      ownerMemberId: DEMO_MEMBER.userId,
      provider: "microsoft_mail",
      name: "ann@campus.edu",
      sealedCredentials: "sealed",
      scopes: ["Mail.Send"],
    });
    await db.updateApplicationConnection(sender.id, { status: "connected" });
    await expect(
      assertHumanReviewFlowsPublishable(ctx(db), [
        flow({ actionSettings: { human_review: { ...settings, senderConnectionId: sender.id } } }),
        flow({ enabled: false, actionSettings: { human_review: { title: "" } } }),
      ])
    ).resolves.toBeUndefined();
  });

  it("names the flow and the missing piece", async () => {
    const db = getMockDb();
    await expect(
      assertHumanReviewFlowsPublishable(ctx(db), [flow({ actionSettings: {} })])
    ).rejects.toMatchObject({ code: "invalid_input", message: /Refunds.*not configured/ });
    await expect(
      assertHumanReviewFlowsPublishable(ctx(db), [
        flow({ actionSettings: { human_review: { ...settings, assignees: ["nobody@elsewhere.org"] } } }),
      ])
    ).rejects.toMatchObject({ message: /nobody@elsewhere.org is not a member/ });
    await expect(
      assertHumanReviewFlowsPublishable(ctx(db), [flow({ actionSettings: { human_review: settings } })])
    ).rejects.toMatchObject({ message: /sender mailbox is not connected/ });
    await expect(
      assertHumanReviewFlowsPublishable(ctx(db), [
        flow({
          actionSettings: {
            human_review: { ...settings, channel: "slack", slackTarget: "C1", senderConnectionId: undefined },
          },
        }),
      ])
    ).rejects.toBeInstanceOf(OperationError);
  });
});
