import { expect, it } from "vitest";
import type { Conversation } from "./types";
import { sourceUsage } from "./source-usage";
it("counts each cited Source once per answer and excludes internal, proactive and old traffic", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const conversations: Pick<Conversation, "id" | "assistantId" | "teammateId" | "subjectType">[] = [
    { id: "visitor", assistantId: "assistant", teammateId: null, subjectType: "visitor" },
    { id: "member", assistantId: "assistant", teammateId: null, subjectType: "member" },
    { id: "teammate", assistantId: null, teammateId: "teammate", subjectType: "member" },
  ];
  const citation = [{ type: "sources", sources: [{ sourceId: "source" }, { sourceId: "source" }] }];
  const answer = { id: "m1", conversationId: "visitor", role: "assistant" as const, feedback: -1 as const, content: citation, createdAt: "2026-10-21T12:00:00Z" };
  const messages = [answer,
    { ...answer, id: "member-answer", conversationId: "member" },
    { ...answer, id: "teammate-answer", conversationId: "teammate" },
    { ...answer, id: "notification", content: [...citation, { type: "notification" }] },
    { ...answer, id: "old", createdAt: "2026-01-01T00:00:00Z" },
    { ...answer, id: "older-answer", createdAt: "2026-09-01T12:00:00Z", feedback: 1 as const },
  ];
  expect(sourceUsage({ sourceIds: ["source", "unused"], conversations, messages, assistants: [{ id: "assistant", title: "Helper" }], now })).toEqual([
    { sourceId: "source", cited30: 1, positive30: 0, negative30: 1, lastCitedAt: new Date(answer.createdAt).toISOString(), unused90: false, assistants: [{ id: "assistant", title: "Helper", answers: 1 }] },
    { sourceId: "unused", cited30: 0, positive30: 0, negative30: 0, lastCitedAt: null, unused90: true, assistants: [] },
  ]);
});
