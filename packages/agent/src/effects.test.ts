import { describe, expect, it, vi } from "vitest";
import type { Db } from "@agent-hub/db";
import { applyEffects } from "./effects";

/**
 * The deferred-effects contract (ARCHITECTURE §5.1): effects run in order
 * AFTER the assistant message persisted, each isolated so one failure never
 * breaks the others, and `create_improvement` goes through the shared
 * conversation-scoped dedup walk (attach an occurrence to an open item,
 * never clone it).
 */

const CTX = {
  organizationId: "org-1",
  conversationId: "conv-1",
  messageId: "msg-9",
};

function fakeDb(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    listConversationImprovementLinks: vi.fn(async () => []),
    getImprovement: vi.fn(async () => null),
    linkImprovementMessage: vi.fn(async () => {}),
    createImprovement: vi.fn(async (_org: string, input: { title: string }) => ({
      id: "imp-new",
      title: input.title,
      status: "to_do",
    })),
    ...overrides,
  } as unknown as Db;
}

describe("applyEffects", () => {
  it("raises a new Improvement when the conversation has no open one", async () => {
    const db = fakeDb();
    await applyEffects(
      [{ kind: "create_improvement", title: "Missing fee answer" }],
      { db, ...CTX }
    );
    expect(
      (db as unknown as { createImprovement: ReturnType<typeof vi.fn> })
        .createImprovement
    ).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ title: "Missing fee answer", messageId: "msg-9" })
    );
  });

  it("attaches an occurrence to an open Improvement instead of cloning it", async () => {
    const db = fakeDb({
      listConversationImprovementLinks: vi.fn(async () => [
        { improvementId: "imp-1" },
      ]),
      getImprovement: vi.fn(async () => ({ id: "imp-1", status: "in_progress" })),
    });
    await applyEffects(
      [{ kind: "create_improvement", title: "Missing fee answer" }],
      { db, ...CTX }
    );
    const spies = db as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(spies.linkImprovementMessage).toHaveBeenCalledWith("imp-1", "msg-9");
    expect(spies.createImprovement).not.toHaveBeenCalled();
  });

  it("raises fresh when the linked Improvements are all closed", async () => {
    const db = fakeDb({
      listConversationImprovementLinks: vi.fn(async () => [
        { improvementId: "imp-1" },
      ]),
      getImprovement: vi.fn(async () => ({ id: "imp-1", status: "done" })),
    });
    await applyEffects(
      [{ kind: "create_improvement", title: "Recurred after close" }],
      { db, ...CTX }
    );
    const spies = db as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(spies.linkImprovementMessage).not.toHaveBeenCalled();
    expect(spies.createImprovement).toHaveBeenCalledTimes(1);
  });

  it("runs effects in order and isolates a failing one", async () => {
    const order: string[] = [];
    const db = fakeDb({
      listConversationImprovementLinks: vi.fn(async () => {
        order.push("walk");
        if (order.filter((o) => o === "walk").length === 1) {
          throw new Error("tracker down");
        }
        return [];
      }),
      createImprovement: vi.fn(async (_org: string, input: { title: string }) => {
        order.push(`raise:${input.title}`);
        return { id: "imp-new", title: input.title, status: "to_do" };
      }),
    });
    await expect(
      applyEffects(
        [
          { kind: "create_improvement", title: "first" },
          { kind: "create_improvement", title: "second" },
        ],
        { db, ...CTX }
      )
    ).resolves.toBeUndefined();
    // First effect's walk threw and was contained; second ran to completion.
    expect(order).toEqual(["walk", "walk", "raise:second"]);
  });
});
