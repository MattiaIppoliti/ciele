import { describe, expect, it } from "vitest";
import {
  AI_OPERATOR,
  canOperateConversations,
  effectiveOperatorState,
  suppressesTurn,
  waitExpiresAt,
  waitTimedOut,
  waitingQueue,
} from "./operator";
import type { ConversationOperator } from "./types";

const NOW = new Date("2026-10-21T10:00:00.000Z");

function waiting(startedMinutesAgo: number, timeout: number | null = 5): ConversationOperator {
  return {
    ...AI_OPERATOR,
    state: "waiting",
    waitingSince: new Date(NOW.getTime() - startedMinutesAgo * 60_000).toISOString(),
    waitingHelpDeskId: "desk-1",
    waitingChannelId: "ch-1",
    waitTimeoutMinutes: timeout,
  };
}

describe("effectiveOperatorState", () => {
  it("is the AI when nothing was stored", () => {
    expect(effectiveOperatorState(undefined, NOW)).toBe("ai");
    expect(effectiveOperatorState(AI_OPERATOR, NOW)).toBe("ai");
  });

  it("is held while a Member holds the Conversation, whatever the clock says", () => {
    expect(
      effectiveOperatorState({ ...AI_OPERATOR, state: "held", memberId: "u-1", memberName: "Dana" }, NOW)
    ).toBe("held");
  });

  it("is waiting until the timeout passes, then the AI again", () => {
    expect(effectiveOperatorState(waiting(4), NOW)).toBe("waiting");
    expect(effectiveOperatorState(waiting(5), NOW)).toBe("ai");
    expect(effectiveOperatorState(waiting(30, 60), NOW)).toBe("waiting");
  });

  it("falls back to the default timeout when the row carries none", () => {
    expect(effectiveOperatorState(waiting(4, null), NOW)).toBe("waiting");
    expect(effectiveOperatorState(waiting(6, null), NOW)).toBe("ai");
  });
});

describe("the wait's expiry", () => {
  it("is derived from when the wait started", () => {
    expect(waitExpiresAt(waiting(2))?.toISOString()).toBe("2026-10-21T10:03:00.000Z");
    expect(waitExpiresAt(AI_OPERATOR)).toBeNull();
  });

  it("reports a timed-out wait only for a wait that ran out", () => {
    expect(waitTimedOut(waiting(10), NOW)).toBe(true);
    expect(waitTimedOut(waiting(1), NOW)).toBe(false);
    expect(waitTimedOut(AI_OPERATOR, NOW)).toBe(false);
  });
});

describe("suppressesTurn", () => {
  it("suppresses while held or waiting and not otherwise", () => {
    expect(suppressesTurn({ ...AI_OPERATOR, state: "held" }, NOW)).toBe(true);
    expect(suppressesTurn(waiting(1), NOW)).toBe(true);
    expect(suppressesTurn(waiting(9), NOW)).toBe(false);
    expect(suppressesTurn(AI_OPERATOR, NOW)).toBe(false);
  });
});

describe("waitingQueue", () => {
  it("lists live waits oldest first with how long each waited", () => {
    const queue = waitingQueue(
      [
        { id: "a", operator: waiting(1) },
        { id: "b", operator: waiting(3) },
        { id: "c", operator: waiting(12) },
        { id: "d", operator: { ...AI_OPERATOR, state: "held" as const } },
        { id: "e" },
      ],
      NOW
    );
    expect(queue.map((entry) => entry.conversation.id)).toEqual(["b", "a"]);
    expect(queue[0]!.waitedMs).toBe(3 * 60_000);
  });
});

describe("canOperateConversations", () => {
  it("allows editors and above and refuses a viewer", () => {
    expect(canOperateConversations("owner")).toBe(true);
    expect(canOperateConversations("admin")).toBe(true);
    expect(canOperateConversations("editor")).toBe(true);
    expect(canOperateConversations("viewer")).toBe(false);
    expect(canOperateConversations("support_agent")).toBe(true);
    expect(canOperateConversations(null)).toBe(false);
  });
});
