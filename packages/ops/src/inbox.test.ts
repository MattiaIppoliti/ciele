import { describe, expect, it, vi } from "vitest";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";

import {
  getInboxConversationReviewOp,
  getInboxFacetsOp,
  listInboxPageOp,
  readConversationsForExportOp,
  readInboxSummaryWindowOp,
  setConversationLegalHoldOp,
} from "./inbox";
import type { OperationContext } from "./operation";

function context(): OperationContext {
  return {
    organizationId: DEMO_ORG.id,
    userId: DEMO_MEMBER.userId,
    role: "viewer",
    db: getMockDb(),
    ports: {},
  };
}

describe("Inbox read model", () => {
  it("uses the same full query contract for pages and bounded summary traversal", async () => {
    const ctx = context();
    const pageSpy = vi.spyOn(ctx.db, "getInboxPage");
    const query = { search: "demo", feedback: "up" as const, staff: "include" as const };

    await listInboxPageOp.run(ctx, { ...query, limit: 7 });
    expect(pageSpy).toHaveBeenCalledWith(
      DEMO_ORG.id,
      expect.objectContaining({ ...query, limit: 7 }),
    );

    const summary = await readInboxSummaryWindowOp.run(ctx, {
      query,
      limit: 25,
    });
    expect(summary.conversations.length).toBeLessThanOrEqual(25);
    expect(pageSpy).toHaveBeenLastCalledWith(
      DEMO_ORG.id,
      expect.objectContaining({ ...query, limit: 25 }),
    );
  });

  it("reads export transcripts from filtered pages instead of the legacy unbounded list", async () => {
    const ctx = context();
    const pageSpy = vi.spyOn(ctx.db, "getInboxPage");
    const first = (await ctx.db.getInboxPage(DEMO_ORG.id, { limit: 1 }))
      .conversations[0];

    const result = await readConversationsForExportOp.run(ctx, {
      query: { conversationIds: [first.id, "forged-id"] },
      limit: 500,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.conversation.id).toBe(first.id);
    expect(pageSpy).toHaveBeenLastCalledWith(
      DEMO_ORG.id,
      expect.objectContaining({ conversationIds: [first.id, "forged-id"] }),
    );
  });

  it("guards facets and review hydration through the organization read boundary", async () => {
    const ctx = context();
    const page = await listInboxPageOp.run(ctx, { limit: 1 });
    const first = page.conversations[0];

    await expect(getInboxFacetsOp.run(ctx, {})).resolves.toMatchObject({
      locations: expect.any(Array),
    });
    await expect(
      getInboxConversationReviewOp.run(ctx, { conversationId: first.id }),
    ).resolves.toMatchObject({ messages: expect.any(Array) });

    await expect(
      getInboxConversationReviewOp.run(
        { ...ctx, organizationId: "foreign-org" },
        { conversationId: first.id },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  // The Human review card shipped reading a `reviews` state nothing filled on
  // select, so it either never appeared or showed the *previous* Conversation's
  // requests. It belongs to the same hydration as the transcript: one read, one
  // conversation, and never a list that outlives the selection.
  it("hydrates the conversation's review requests with its transcript", async () => {
    const ctx = context();
    const page = await listInboxPageOp.run(ctx, { limit: 10 });
    const first = page.conversations[0]!;

    const listSpy = vi.spyOn(ctx.db, "table");
    const review = await getInboxConversationReviewOp.run(ctx, {
      conversationId: first.id,
    });
    expect(review.reviews).toEqual(expect.any(Array));
    expect(listSpy).toHaveBeenCalledWith("reviewRequests");

    await ctx.db.table("reviewRequests").insert({
      organizationId: DEMO_ORG.id,
      assistantId: first.assistantId ?? "assistant-demo",
      conversationId: first.id,
      flowId: "flow-demo",
      actionIndex: 0,
      title: "Approve refund",
      message: "",
      summary: "",
      channel: "email",
      assignees: ["ann@campus.edu"],
      inputs: [],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      haltMessage: "",
      simulated: false,
    });

    const withReview = await getInboxConversationReviewOp.run(ctx, {
      conversationId: first.id,
    });
    expect(withReview.reviews).toHaveLength(1);
    expect(withReview.reviews[0]!.conversationId).toBe(first.id);

    // A request belonging to another Conversation must not ride along: the
    // stale card the fix removes was exactly a list from a different one.
    await ctx.db.table("reviewRequests").insert({
      organizationId: DEMO_ORG.id,
      assistantId: first.assistantId ?? "assistant-demo",
      conversationId: "conv-somewhere-else",
      flowId: "flow-demo",
      actionIndex: 0,
      title: "Somewhere else",
      message: "",
      summary: "",
      channel: "email",
      assignees: ["bob@campus.edu"],
      inputs: [],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      haltMessage: "",
      simulated: false,
    });
    const still = await getInboxConversationReviewOp.run(ctx, {
      conversationId: first.id,
    });
    expect(still.reviews.map((r) => r.conversationId)).toEqual([first.id]);
  });
});

describe("legal hold (#801, CYB-12)", () => {
  it("flips the flag on an owned conversation and survives a page read", async () => {
    const ctx = context();
    const first = (await ctx.db.getInboxPage(DEMO_ORG.id, { limit: 1 }))
      .conversations[0]!;

    const held = await setConversationLegalHoldOp.run(ctx, {
      id: first.id,
      legalHold: true,
    });
    expect(held.legalHold).toBe(true);

    const reread = (
      await ctx.db.getInboxPage(DEMO_ORG.id, {
        conversationIds: [first.id],
        staff: "include",
        limit: 1,
      })
    ).conversations[0]!;
    expect(reread.legalHold).toBe(true);

    const released = await setConversationLegalHoldOp.run(ctx, {
      id: first.id,
      legalHold: false,
    });
    expect(released.legalHold).toBe(false);
  });

  it("is an administrative act, not a member one", () => {
    // Suspending a deletion the Organization committed to is the same rung as
    // setting the retention window itself.
    expect(setConversationLegalHoldOp.capability).toBe("manageMembers");
  });

  it("refuses a conversation outside the caller's Organization", async () => {
    const ctx = context();
    await expect(
      setConversationLegalHoldOp.run(
        { ...ctx, organizationId: "some-other-org" },
        { id: "conv-demo", legalHold: true },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("deleting a Conversation with an open webhook gate (#842)", () => {
  it("tells the other system to stop before the row cascades away", async () => {
    const ctx = context();
    const assistant = await ctx.db.createAssistant(DEMO_ORG.id, { title: "Gate" });
    const conversation = await ctx.db.createConversation({
      assistantId: assistant.id,
      subjectType: "visitor",
      subjectId: "v-1",
      title: "Waiting",
    });
    const order: string[] = [];
    const deleteConversation = ctx.db.deleteConversation.bind(ctx.db);
    ctx.db.deleteConversation = async (id) => {
      order.push(`delete:${id}`);
      await deleteConversation(id);
    };
    ctx.ports = {
      unsubscribeWebhooks: async (id) => {
        order.push(`unsubscribe:${id}`);
      },
    };
    const { deleteConversationOp } = await import("./inbox");
    await deleteConversationOp.run(ctx, { id: conversation.id });
    expect(order).toEqual([`unsubscribe:${conversation.id}`, `delete:${conversation.id}`]);
    expect(await ctx.db.getConversation(conversation.id)).toBeNull();
  });
});
