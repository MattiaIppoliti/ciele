import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@agent-hub/agent/client";
import { chatFeedbackForEvent } from "./chat-feedback";

const asEvent = (event: Record<string, unknown>) => event as unknown as RuntimeEvent;

describe("chatFeedbackForEvent", () => {
  it("marks the lifecycle: tool done, reply done, turn failed", () => {
    expect(chatFeedbackForEvent(asEvent({ type: "tool-end", callId: "c1" }))).toBe("complete");
    expect(
      chatFeedbackForEvent(asEvent({ type: "done", conversationId: "x", messageId: null })),
    ).toBe("reply");
    expect(chatFeedbackForEvent(asEvent({ type: "error", message: "boom" }))).toBe("error");
  });

  it("stays silent through the streaming itself", () => {
    for (const type of [
      "start",
      "text-start",
      "text-delta",
      "text-end",
      "tool-start",
      "tool-input-start",
      "tool-input-delta",
      "tool-input-end",
      "tool-call",
      "part",
      "step",
      "progress",
    ]) {
      expect(chatFeedbackForEvent(asEvent({ type })), type).toBeNull();
    }
  });

  it("gives a channel chain one reply per finished Teammate turn and nothing for the cap", () => {
    // The channel consumer taps only turn events; `channel-speaker`,
    // `channel-message` and `channel-end` never reach `onEvent`, so a capped
    // chain of three turns is three cues, whatever the cap marker says.
    const turn = [{ type: "start" }, { type: "text-delta", delta: "x" }, { type: "done" }];
    const cues = [...turn, ...turn, ...turn]
      .map((e) => chatFeedbackForEvent(asEvent(e)))
      .filter(Boolean);
    expect(cues).toEqual(["reply", "reply", "reply"]);
  });

  it("produces exactly one reply cue for a long streamed answer", () => {
    const stream = [
      { type: "start" },
      { type: "text-start" },
      ...Array.from({ length: 200 }, () => ({ type: "text-delta", delta: "x" })),
      { type: "text-end" },
      { type: "done" },
    ];
    const cues = stream.map((e) => chatFeedbackForEvent(asEvent(e))).filter(Boolean);
    expect(cues).toEqual(["reply"]);
  });
});
