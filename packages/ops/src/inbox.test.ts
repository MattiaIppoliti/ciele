import { describe, expect, it, vi } from "vitest";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";

import {
  getInboxConversationReviewOp,
  getInboxFacetsOp,
  listInboxPageOp,
  readConversationsForExportOp,
  readInboxSummaryWindowOp,
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
});
