import { describe, expect, it } from "vitest";
import type { StoredMessage } from "@agent-hub/core";
import { chatMessagesFromStored } from "./stored-messages";

const message: StoredMessage = {
  id: "m1", conversationId: "c1", role: "assistant", content: [{ type: "text", text: "Answer" }],
  flowId: "f1", flowName: "Admissions", feedback: 1, feedbackReaction: "positive", createdAt: "2026-10-01T12:00:00Z",
  trace: { steps: [{ id: "thought", kind: "thought", label: "Private reasoning", status: "done" }, { id: "search", kind: "tool", tool: "searchKnowledge", label: "Searching", status: "done" }], searchCount: 2, iteration: 3, iterationLimit: 5, terminal: "answer" },
};

describe("stored conversation restoration", () => {
  it("restores a finished reply with its Flow, timestamp, feedback and operational trace", () => {
    expect(chatMessagesFromStored([message])[0]).toMatchObject({
      role: "bot", id: "m1", sentAt: message.createdAt, flowName: "Admissions", phase: "done", streamingText: null,
      feedback: 1, feedbackReaction: "positive", searchCount: 2, iteration: 3, iterationLimit: 5,
      steps: [{ id: "search", kind: "tool" }],
    });
  });
  it("includes reasoning only when the reader is allowed to see it", () => {
    const [reply] = chatMessagesFromStored([message], { canViewReasoning: true });
    expect(reply).toMatchObject({ steps: message.trace?.steps });
  });
  it("joins all user text parts and restores the original timestamp", () => {
    const [user] = chatMessagesFromStored([{ ...message, role: "user", content: [{ type: "text", text: "Hello " }, { type: "text", text: "there" }], trace: null }]);
    expect(user).toEqual({ role: "user", text: "Hello there", sentAt: message.createdAt });
  });
  it("restores a legacy or verbatim reply without inventing a running trace", () => {
    expect(chatMessagesFromStored([{ ...message, trace: null }])[0]).toMatchObject({ phase: "done", steps: [], searchCount: 0, iteration: null, terminal: null });
  });
  it("restores interactive tables with their original sourced rows and call identities", () => {
    const content = [
      { type: "component", name: "records_table", action: "search_knowledge", callId: "crm-1", props: { rows: [{ id: "company-1", name: "Acme", tags: ["Customer"], last: "2026-10-01", strength: "strong" }] } },
      { type: "component", name: "filter_table", action: "search_knowledge", callId: "tasks-1", props: { rows: [{ task: "Review contract", date: "2026-10-04", status: "todo", owner: "Alex" }] } },
    ];
    expect(chatMessagesFromStored([{ ...message, content }])[0]).toMatchObject({ phase: "done", parts: content });
  });
});
