import { describe, expect, it } from "vitest";

import { createTurnObserver } from "./turn-observer";
import type { ChatReplyPart, RuntimeEvent } from "./types";

describe("createTurnObserver", () => {
  it("keeps the operator trace, forwards the public event, and appends one tool audit part", () => {
    const forwarded: RuntimeEvent[] = [];
    const observer = createTurnObserver((event) => forwarded.push(event));

    observer.emit({
      type: "tool-start",
      callId: "call-1",
      tool: "searchKnowledge",
      label: "Search the Library",
      input: { query: "refunds" },
    });
    observer.emit({
      type: "tool-end",
      callId: "call-1",
      tool: "searchKnowledge",
      ok: true,
      summary: "Found the refund policy",
      result: { visible: true },
      operatorResult: { internalUrl: "https://internal.invalid/result" },
      durationMs: 4,
    });

    expect(forwarded.at(-1)).not.toHaveProperty("operatorResult");
    expect(observer.trace.steps.at(-1)).toMatchObject({
      id: "call-1",
      result: { internalUrl: "https://internal.invalid/result" },
    });
    expect(observer.toolCalls).toBe(1);
    expect(
      observer.partsWithAudit([
        { type: "text", action: "search_knowledge", text: "Five days." },
      ] as ChatReplyPart[]),
    ).toEqual([
      { type: "text", action: "search_knowledge", text: "Five days." },
      {
        type: "tool_calls",
        calls: [
          {
            tool: "searchKnowledge",
            label: "Search the Library",
            ok: true,
            summary: "Found the refund policy",
          },
        ],
      },
    ]);
  });
});
