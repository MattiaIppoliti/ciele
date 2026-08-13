import { describe, expect, it, vi } from "vitest";
import { DEMO_ORG, getMockDb } from "./index";
import {
  IMPROVEMENT_TITLE_MAX,
  raiseImprovement,
  raiseOrAttachImprovement,
} from "./improvements";
import type { Db } from "./types";

const db = getMockDb();

describe("raiseImprovement", () => {
  it("creates an Improvement with a trimmed title and null message link", async () => {
    const improvement = await raiseImprovement(db, DEMO_ORG.id, {
      title: "  Needs a better answer  ",
    });
    expect(improvement).not.toBeNull();
    expect(improvement!.title).toBe("Needs a better answer");
    expect(improvement!.status).toBe("to_do");
  });

  it(`clamps titles at ${IMPROVEMENT_TITLE_MAX} characters`, async () => {
    const improvement = await raiseImprovement(db, DEMO_ORG.id, {
      title: "x".repeat(500),
    });
    expect(improvement!.title).toHaveLength(IMPROVEMENT_TITLE_MAX);
  });

  it("rejects an empty title", async () => {
    await expect(
      raiseImprovement(db, DEMO_ORG.id, { title: "   " })
    ).rejects.toThrow("Title is required");
  });

  it("propagates tracker failures by default", async () => {
    const failing = {
      createImprovement: async () => {
        throw new Error("tracker down");
      },
    } as unknown as Db;
    await expect(
      raiseImprovement(failing, DEMO_ORG.id, { title: "Boom" })
    ).rejects.toThrow("tracker down");
  });

  it("swallows tracker failures for background callers", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = {
      createImprovement: async () => {
        throw new Error("tracker down");
      },
    } as unknown as Db;
    await expect(
      raiseImprovement(
        failing,
        DEMO_ORG.id,
        { title: "Boom" },
        { swallowErrors: true }
      )
    ).resolves.toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("raiseOrAttachImprovement", () => {
  const walkDb = (improvement: { id: string; status: string } | null) =>
    ({
      listConversationImprovementLinks: async () =>
        improvement ? [{ improvementId: improvement.id }] : [],
      getImprovement: async () => improvement,
      linkImprovementMessage: vi.fn(async () => {}),
      createImprovement: vi.fn(async (_org: string, input: { title: string }) => ({
        id: "imp-new",
        title: input.title,
        status: "to_do",
      })),
    }) as unknown as Db;

  it("attaches the message to an open Improvement on the conversation", async () => {
    const db = walkDb({ id: "imp-open", status: "to_do" });
    const result = await raiseOrAttachImprovement(db, DEMO_ORG.id, {
      title: "dup",
      messageId: "msg-1",
      conversationId: "conv-1",
    });
    expect(result).toEqual({
      improvement: { id: "imp-open", status: "to_do" },
      attached: true,
    });
    const spies = db as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(spies.linkImprovementMessage).toHaveBeenCalledWith("imp-open", "msg-1");
    expect(spies.createImprovement).not.toHaveBeenCalled();
  });

  it("raises fresh when the only linked Improvement is closed", async () => {
    const db = walkDb({ id: "imp-done", status: "done" });
    const result = await raiseOrAttachImprovement(db, DEMO_ORG.id, {
      title: "recurrence",
      messageId: "msg-1",
      conversationId: "conv-1",
    });
    expect(result?.attached).toBe(false);
    expect(result?.improvement.id).toBe("imp-new");
  });

  it("skips the walk entirely without a messageId (nothing to attach)", async () => {
    const db = walkDb({ id: "imp-open", status: "to_do" });
    const result = await raiseOrAttachImprovement(db, DEMO_ORG.id, {
      title: "no message",
      messageId: null,
      conversationId: "conv-1",
    });
    expect(result?.attached).toBe(false);
    const spies = db as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(spies.linkImprovementMessage).not.toHaveBeenCalled();
  });

  it("swallows walk failures for background callers", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = {
      listConversationImprovementLinks: async () => {
        throw new Error("tracker down");
      },
    } as unknown as Db;
    await expect(
      raiseOrAttachImprovement(
        failing,
        DEMO_ORG.id,
        { title: "boom", messageId: "msg-1", conversationId: "conv-1" },
        { swallowErrors: true }
      )
    ).resolves.toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
