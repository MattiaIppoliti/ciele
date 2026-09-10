import { describe, expect, it } from "vitest";
import { DEMO_MEMBER, DEMO_ORG, createOrgPinnedDb, getMockDb } from "@agent-hub/db";
import type { Db } from "@agent-hub/db";
import type { ReviewRequest } from "@agent-hub/core";
import { decideReviewOp, getReviewOp, listReviewsOp } from "./reviews";
import type { OperationContext } from "./operation";

/**
 * The Reviews domain over an API key (#841), on the fail-closed pinned Db.
 * Same purpose as `api-surface.test.ts`: the drift tests agree about names,
 * this is what proves the three operations can actually run for a key. A
 * table missing from `PINNED_TABLES`, or a Db method missing from the pinned
 * view's allow-lists, throws `OrgPinnedDbError` here and nowhere else.
 */

const pinned = (inner: Db = getMockDb()) => createOrgPinnedDb(inner, DEMO_ORG.id);

const keyContext = (db: Db, overrides: Partial<OperationContext> = {}): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "owner",
  actorEmail: DEMO_MEMBER.email,
  db,
  ...overrides,
});

/** The runtime creates rows; no operation does, so the fixture writes them on the inner Db. */
async function seedReview(inner: Db, organizationId: string): Promise<ReviewRequest> {
  const assistant = await inner.createAssistant(organizationId, { title: "Review Probe" });
  const conversation = await inner.createConversation({
    assistantId: assistant.id,
    subjectType: "visitor",
    subjectId: "visitor-1",
    title: "Refund",
  });
  return inner.table("reviewRequests").insert({
    organizationId,
    assistantId: assistant.id,
    conversationId: conversation.id,
    flowId: "flow-refund",
    actionIndex: 1,
    title: "Approve the refund",
    message: "A Visitor asked for a refund above the automatic limit.",
    summary: "Order A-1, 40 EUR.",
    channel: "email",
    assignees: ["assignee@ciele.local"],
    inputs: [{ id: "amount", label: "Amount", type: "short_text", required: true }],
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    haltMessage: "",
    simulated: false,
  });
}

describe("the Reviews domain over an API key", () => {
  it("runs every endpoint's operation on the pinned Db", async () => {
    const inner = getMockDb();
    const review = await seedReview(inner, DEMO_ORG.id);
    const ctx = keyContext(pinned(inner));

    const list = await listReviewsOp.run(ctx, {});
    expect(list.map((row) => row.id)).toContain(review.id);
    const pending = await listReviewsOp.run(ctx, {
      status: "pending",
      conversationId: review.conversationId,
      assistantId: review.assistantId,
      limit: 10,
    });
    expect(pending.map((row) => row.id)).toEqual([review.id]);

    expect((await getReviewOp.run(ctx, { id: review.id })).title).toBe("Approve the refund");

    const decided = await decideReviewOp.run(ctx, {
      id: review.id,
      decision: "approved",
      inputs: { amount: "40" },
    });
    expect(decided.review.status).toBe("approved");
    expect(decided.review.decision).toEqual({ amount: "40" });
    expect(decided.review.decidedBy).toBe(DEMO_MEMBER.userId);
    // No `afterReviewDecided` port on a key request: the continuation is a job.
    expect(decided.resumed).toBeNull();

    // First decision wins, and the loser is told so. (`run` is the raw handler,
    // so the schema's `inputs` default is spelled out here as a route would.)
    await expect(
      decideReviewOp.run(ctx, { id: review.id, decision: "rejected", inputs: {} })
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("lets an assignee key decide and refuses a Viewer key that is not one", async () => {
    const inner = getMockDb();
    const review = await seedReview(inner, DEMO_ORG.id);
    const stranger = keyContext(pinned(inner), {
      role: "viewer",
      actorEmail: "stranger@ciele.local",
    });
    await expect(
      decideReviewOp.run(stranger, { id: review.id, decision: "rejected", inputs: {} })
    ).rejects.toMatchObject({ code: "conflict" });

    const assignee = keyContext(pinned(inner), {
      role: "viewer",
      actorEmail: "assignee@ciele.local",
      actorName: "An Assignee",
    });
    const decided = await decideReviewOp.run(assignee, {
      id: review.id,
      decision: "rejected",
      inputs: {},
    });
    expect(decided.review.status).toBe("rejected");
    expect(decided.review.decidedByName).toBe("An Assignee");
  });

  it("refuses another Organization's request through the pinned view", async () => {
    const inner = getMockDb();
    const foreign = await seedReview(inner, "some-other-org");
    const ctx = keyContext(pinned(inner));
    // The pinned view resolves the row to its owner and reads it as absent, so
    // the operation's own `not_found` is what the caller sees.
    await expect(getReviewOp.run(ctx, { id: foreign.id })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      decideReviewOp.run(ctx, { id: foreign.id, decision: "approved", inputs: {} })
    ).rejects.toMatchObject({ code: "not_found" });
    expect((await listReviewsOp.run(ctx, {})).map((row) => row.id)).not.toContain(foreign.id);
  });
});
