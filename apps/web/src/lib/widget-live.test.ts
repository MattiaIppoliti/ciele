import { describe, expect, it } from "vitest";
import { AI_OPERATOR, type Conversation, type StoredMessage } from "@agent-hub/core";
import {
  LIVE_LINGER_POLL_MS,
  LIVE_POLL_MS,
  mergeById,
  nextLivePollDelay,
  widgetLiveState,
  widgetMessage,
} from "./widget-live";

const NOW = new Date("2026-10-21T10:00:00.000Z");

function conversation(operator: Conversation["operator"]): Conversation {
  return {
    id: "c1",
    assistantId: "a1",
    teammateId: null,
    subjectType: "visitor",
    subjectId: "v1",
    collectionId: null,
    title: "",
    metadata: {},
    sessionState: {},
    sessionVersion: 0,
    pinned: false,
    operator,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

describe("widgetLiveState", () => {
  it("names the Member holding the Conversation", () => {
    expect(
      widgetLiveState(conversation({ ...AI_OPERATOR, state: "held", memberId: "u1", memberName: "Dana" }), NOW)
    ).toMatchObject({ state: "held", operatorName: "Dana", waitTimedOut: false });
  });

  it("reports a wait that ran out as the AI's, flagged so the Widget can say so", () => {
    const started = new Date(NOW.getTime() - 6 * 60_000).toISOString();
    expect(
      widgetLiveState(
        conversation({ ...AI_OPERATOR, state: "waiting", waitingSince: started, waitTimeoutMinutes: 5, waitingHelpDeskId: "d1" }),
        NOW
      )
    ).toMatchObject({ state: "ai", waitTimedOut: true, helpDeskId: "d1" });
  });

  it("is the AI's for a Conversation that does not exist yet", () => {
    expect(widgetLiveState(null, NOW).state).toBe("ai");
  });
});

describe("widgetMessage", () => {
  it("never sends the operator's Member id to a Visitor", () => {
    const message = {
      id: "m1",
      conversationId: "c1",
      role: "operator",
      content: [{ type: "text", text: "hi" }],
      authorMemberId: "u-secret",
      authorName: "Dana",
      flowId: null,
      flowName: null,
      feedback: 0,
      trace: null,
      createdAt: NOW.toISOString(),
    } satisfies StoredMessage;
    const visible = widgetMessage(message);
    expect(visible).not.toHaveProperty("authorMemberId");
    expect(visible.authorName).toBe("Dana");
  });
});

describe("nextLivePollDelay", () => {
  const now = NOW.getTime();
  it("polls every few seconds while held or waiting", () => {
    expect(nextLivePollDelay({ state: "held", lastVisitorMessageAt: null, now })).toBe(LIVE_POLL_MS);
    expect(nextLivePollDelay({ state: "waiting", lastVisitorMessageAt: null, now })).toBe(LIVE_POLL_MS);
  });

  it("checks slowly for a few minutes after the Visitor wrote, then stops", () => {
    expect(nextLivePollDelay({ state: "ai", lastVisitorMessageAt: now - 60_000, now })).toBe(LIVE_LINGER_POLL_MS);
    expect(nextLivePollDelay({ state: "ai", lastVisitorMessageAt: now - 6 * 60_000, now })).toBeNull();
  });

  it("makes no requests from an idle Widget", () => {
    expect(nextLivePollDelay({ state: null, lastVisitorMessageAt: null, now })).toBeNull();
    expect(nextLivePollDelay({ state: "ai", lastVisitorMessageAt: null, now })).toBeNull();
  });
});

describe("mergeById", () => {
  it("adds only unseen messages, in order", () => {
    expect(mergeById([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
});
