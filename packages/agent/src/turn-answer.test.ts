import { describe, expect, it, vi } from "vitest";
import type { RuntimeEvent } from "./types";

/**
 * The turn read back whole. The turn itself is stubbed at its one entrypoint,
 * so what is asserted is the fold: the events a real turn emits, as NDJSON on
 * a real stream, become one answer with its citations, its Flow and its ids,
 * and a failed turn says so instead of reading as a successful empty answer.
 */

let events: RuntimeEvent[] = [];

vi.mock("./turn", () => ({
  streamConversationTurn: async () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const event of events) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        controller.close();
      },
    }),
}));

const { answerConversationTurn } = await import("./turn-answer");

const source = {
  conceptId: "c1",
  conceptTitle: "Collegare Salesforce Knowledge a Ciele",
  collectionName: "Knowledge Library",
  sourceName: "Salesforce",
  url: "https://example.my.salesforce.com/kA1",
  sourceId: "s1",
};

describe("answerConversationTurn", () => {
  it("folds the streamed turn into one answer with its Sources, once each", async () => {
    events = [
      { type: "turn", conversationId: "conv-1" },
      { type: "flow", flowId: null, flowName: "Default behavior", isDefault: true },
      { type: "part", part: { type: "sources", action: "search_knowledge", sources: [source] } },
      { type: "text-start", action: "search_knowledge" },
      { type: "text-delta", delta: "Apri Library, " },
      { type: "text-delta", delta: "poi Applications." },
      { type: "text-end" },
      { type: "part", part: { type: "sources", action: "search_knowledge", sources: [source] } },
      { type: "done", conversationId: "conv-1", messageId: "msg-1" },
    ];
    const answer = await answerConversationTurn({} as never);
    expect(answer).toMatchObject({
      conversationId: "conv-1",
      messageId: "msg-1",
      flowName: "Default behavior",
      answer: "Apri Library, poi Applications.",
      error: null,
    });
    expect(answer.sources).toEqual([source]);
  });

  it("reports a failed turn instead of passing its fallback off as an answer", async () => {
    events = [
      { type: "turn", conversationId: "conv-2" },
      { type: "error", message: "No provider connection" },
    ];
    const answer = await answerConversationTurn({} as never);
    expect(answer.conversationId).toBe("conv-2");
    expect(answer.messageId).toBeNull();
    expect(answer.error).toBe("No provider connection");
  });
});
