import { describe, expect, it, vi } from "vitest";
import type { Db } from "@agent-hub/db";
import type { RunResult } from "./types";
import {
  handoverFlowName,
  handoverTarget,
  mergeHandoverContinuation,
  runHandoverContinuation,
  type HandoverContinuation,
} from "./handover";

/**
 * The three rules the continuation exists to enforce, each previously
 * reachable only by driving a whole Conversation Turn: one hop, same
 * Organization, and never worse than the acknowledgement already streamed.
 */

const ORG = "org-1";

function publication(over: Record<string, unknown> = {}) {
  return {
    createdAt: "2026-08-01T00:00:00.000Z",
    config: {
      assistant: {
        id: "target-1",
        organizationId: ORG,
        title: "Billing",
        knowledgeEngine: "vector",
      },
      flows: [],
      skills: [],
    },
    ...over,
  };
}

function makeDb(overrides: Partial<Record<keyof Db, unknown>> = {}) {
  return {
    getLatestPublication: vi.fn(async () => publication()),
    getApiIntegration: vi.fn(async () => null),
    ...overrides,
  } as unknown as Db;
}

function input(over: Record<string, unknown> = {}) {
  return {
    db: makeDb(),
    connections: [],
    targetId: "target-1",
    organizationId: ORG,
    message: "I need a refund",
    history: [],
    conversationId: "conv-1",
    session: {} as never,
    alreadyClarified: false,
    readKnowledgeDocumentFor: () => async () => null,
    emit: () => {},
    signal: new AbortController().signal,
    ...over,
  } as Parameters<typeof runHandoverContinuation>[0];
}

describe("handoverTarget", () => {
  it("names the hop when a Flow handed off elsewhere", () => {
    expect(handoverTarget({ handoverTo: "other" }, "origin-1")).toBe("other");
  });

  it("is no hop when the Flow named its own Assistant", () => {
    expect(handoverTarget({ handoverTo: "origin-1" }, "origin-1")).toBeNull();
  });

  it("is no hop when no handover ran", () => {
    expect(handoverTarget({ handoverTo: null }, "origin-1")).toBeNull();
    expect(handoverTarget({}, "origin-1")).toBeNull();
  });
});

describe("runHandoverContinuation", () => {
  it("refuses a target in another Organization", async () => {
    const db = makeDb({
      getLatestPublication: vi.fn(async () =>
        publication({
          config: {
            assistant: {
              id: "target-1",
              organizationId: "org-2",
              title: "Someone else's",
              knowledgeEngine: "vector",
            },
            flows: [],
            skills: [],
          },
        })
      ),
    });
    expect(await runHandoverContinuation(input({ db }))).toBeNull();
  });

  it("returns nothing when the target has never been published", async () => {
    const db = makeDb({ getLatestPublication: vi.fn(async () => null) });
    expect(await runHandoverContinuation(input({ db }))).toBeNull();
  });

  it("absorbs a failure, so the turn keeps what it already streamed", async () => {
    const db = makeDb({
      getLatestPublication: vi.fn(async () => {
        throw new Error("publications table down");
      }),
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runHandoverContinuation(input({ db }))).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("rethrows when the Conversation Turn was cancelled", async () => {
    const controller = new AbortController();
    const db = makeDb({
      getLatestPublication: vi.fn(async () => {
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      }),
    });
    await expect(
      runHandoverContinuation(input({ db, signal: controller.signal }))
    ).rejects.toThrow();
  });
});

describe("handoverFlowName", () => {
  it("names both Flows and the Assistant between them", () => {
    expect(handoverFlowName("Refund request", "Billing", "Default behavior")).toBe(
      "Refund request → Billing: Default behavior"
    );
  });
});

describe("mergeHandoverContinuation", () => {
  const result: RunResult = {
    parts: [{ type: "text", action: "custom_message", text: "One moment." }],
    effects: [{ type: "improvement", title: "ack" } as never],
    flowId: "flow-1",
    flowName: "Refund request",
    usage: [{ stage: "generate" } as never],
    handoverTo: "target-1",
  };
  const continuation: HandoverContinuation = {
    parts: [{ type: "text", action: "search_knowledge", text: "Here's the policy." }],
    effects: [{ type: "email" } as never],
    usage: [{ stage: "classify" } as never],
    targetTitle: "Billing",
    flowName: "Default behavior",
  };

  it("appends the continuation in the order it happened", () => {
    const merged = mergeHandoverContinuation(result, continuation);
    expect(merged.parts.map((p) => "text" in p && p.text)).toEqual([
      "One moment.",
      "Here's the policy.",
    ]);
    expect(merged.effects).toHaveLength(2);
    expect(merged.usage).toHaveLength(2);
  });

  it("labels the turn with the route it took", () => {
    expect(mergeHandoverContinuation(result, continuation).flowName).toBe(
      "Refund request → Billing: Default behavior"
    );
  });

  it("keeps the originating Flow's id, the turn is still that Flow's", () => {
    expect(mergeHandoverContinuation(result, continuation).flowId).toBe("flow-1");
  });

  it("leaves the run it was given untouched", () => {
    mergeHandoverContinuation(result, continuation);
    expect(result.parts).toHaveLength(1);
    expect(result.flowName).toBe("Refund request");
  });
});
