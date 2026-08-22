import { describe, expect, it } from "vitest";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { RuntimeEvent } from "../types";
import { createLoopBudget } from "./loop-budget";
import { createTerminalState } from "./ready-to-answer";
import { isRefusal, refusalParts, runGatherPhase } from "./gather-phase";

describe("isRefusal", () => {
  it("recognizes the two provider shapes and nothing else", () => {
    expect(isRefusal("content-filter", undefined)).toBe(true);
    expect(isRefusal("stop", "refusal")).toBe(true);
    expect(isRefusal("stop", "stop")).toBe(false);
    expect(isRefusal(null, undefined)).toBe(false);
    expect(isRefusal("length", undefined)).toBe(false);
  });
});

describe("refusalParts", () => {
  it("pairs the honest refusal with the human exit ramp", () => {
    const [refusal, help] = refusalParts({ contactLabel: "Contact support" });
    expect(refusal).toEqual({
      type: "text",
      action: "refusal",
      text: "I can't help with that request.",
    });
    expect(help).toEqual({
      type: "help_desk",
      action: "suggest_help_desk",
      label: "Contact support",
    });
  });

  it("shows the provider finish reason on the Preview surface only", () => {
    const preview = refusalParts({
      contactLabel: "Contact",
      previewSurface: true,
      rawFinishReason: "safety",
    })[0];
    expect(preview).toMatchObject({
      text: "I can't help with that request. (Provider finish reason: safety.)",
    });
    const widget = refusalParts({
      contactLabel: "Contact",
      previewSurface: false,
      rawFinishReason: "safety",
    })[0];
    expect(widget).toMatchObject({ text: "I can't help with that request." });
  });
});

const usage = () => ({
  inputTokens: { total: 8, noCache: 8, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 3, text: 3, reasoning: undefined },
});

/** A gather stream that emits `deltas` as private reasoning, then finishes. */
function gatherModel(
  deltas: string[],
  finish: { unified: string; raw?: string } = { unified: "stop" }
) {
  return new MockLanguageModelV3({
    doStream: async () =>
      ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { type: "text-start" as const, id: "1" },
            ...deltas.map((delta) => ({
              type: "text-delta" as const,
              id: "1",
              delta,
            })),
            { type: "text-end" as const, id: "1" },
            {
              type: "finish" as const,
              finishReason: { unified: finish.unified, raw: finish.raw ?? finish.unified },
              usage: usage(),
            },
          ],
        }),
        // The mock boundary cast, as in write-phase.test.ts: the chunk union
        // does not unify with the SDK's part type.
      }) as any,
  });
}

function gatherInput(
  chatModel: ReturnType<typeof gatherModel>,
  emit: (event: RuntimeEvent) => void = () => {}
) {
  return {
    chatModel,
    system: "gather",
    messages: [{ role: "user" as const, content: "hi" }],
    tools: {},
    loop: createLoopBudget(),
    terminal: createTerminalState(),
    searchPasses: [],
    emit,
  };
}

describe("runGatherPhase", () => {
  it("streams reasoning as thought-deltas and flushes the whole at the end", async () => {
    const events: RuntimeEvent[] = [];
    const result = await runGatherPhase(
      gatherInput(gatherModel(["Looking ", "for refunds."]), (e) => events.push(e))
    );
    expect(result.finishReason).toBe("stop");
    expect(result.refused).toBe(false);
    expect(events).toEqual([
      { type: "thought-delta", delta: "Looking " },
      { type: "thought-delta", delta: "for refunds." },
      { type: "thought", text: "Looking for refunds." },
    ]);
  });

  it("withholds a delta while the reasoning is still pure whitespace (#584)", async () => {
    const events: RuntimeEvent[] = [];
    await runGatherPhase(
      gatherInput(gatherModel(["\n", "  ", "Real thought."]), (e) => events.push(e))
    );
    expect(events).toEqual([
      { type: "thought-delta", delta: "Real thought." },
      { type: "thought", text: "Real thought." },
    ]);
  });

  it("opens no thought at all when the model reasoned in whitespace only", async () => {
    const events: RuntimeEvent[] = [];
    await runGatherPhase(gatherInput(gatherModel(["  \n "]), (e) => events.push(e)));
    expect(events).toEqual([]);
  });

  it("records the phase's token usage", async () => {
    const recorded: Array<{ inputTokens: number; outputTokens: number }> = [];
    await runGatherPhase({
      ...gatherInput(gatherModel(["thinking"])),
      recordUsage: (u) => recorded.push(u),
    });
    expect(recorded).toEqual([{ inputTokens: 8, outputTokens: 3 }]);
  });

  it("flags a content-filter finish as a refusal and skips the response messages", async () => {
    const result = await runGatherPhase(
      gatherInput(gatherModel([], { unified: "content-filter" }))
    );
    expect(result.refused).toBe(true);
    // The write phase never runs on a refusal, so nothing waits on the
    // response: the turn ends on `refusalParts`.
    expect(result.responseMessages).toEqual([]);
  });

  it("carries the provider's raw finish reason through for the Preview surface", async () => {
    const result = await runGatherPhase(
      gatherInput(gatherModel([], { unified: "stop", raw: "refusal" }))
    );
    expect(result.refused).toBe(true);
    expect(result.rawFinishReason).toBe("refusal");
  });

  it("hands the phase's own messages to the write phase on a normal finish", async () => {
    const result = await runGatherPhase(gatherInput(gatherModel(["done"])));
    expect(result.refused).toBe(false);
    // The write phase writes from what this phase saw, so the messages have to
    // actually arrive, an empty array is the refusal short-circuit's signature.
    expect(result.responseMessages.length).toBeGreaterThan(0);
  });

  /**
   * A refused stream through to the copy it produces: the provider's own stop
   * reason has to reach the Preview's diagnostic, which is the whole reason
   * `rawFinishReason` is carried out of the phase at all.
   */
  it("carries a refused stream through to the refusal copy", async () => {
    const result = await runGatherPhase(
      gatherInput(gatherModel([], { unified: "content-filter", raw: "safety" }))
    );
    expect(result.refused).toBe(true);
    const [refusal, help] = refusalParts({
      contactLabel: "Contact support",
      previewSurface: true,
      rawFinishReason: result.rawFinishReason,
    });
    expect(refusal).toMatchObject({
      action: "refusal",
      text: "I can't help with that request. (Provider finish reason: safety.)",
    });
    expect(help).toMatchObject({ label: "Contact support" });
  });
});
