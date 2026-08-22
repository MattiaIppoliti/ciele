import { describe, expect, it } from "vitest";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { RuntimeEvent } from "../types";
import {
  clarifyQuestion,
  emptyWriteText,
  lengthNoticePart,
  resolveWriteEnding,
  runWritePhase,
} from "./write-phase";

describe("clarifyQuestion", () => {
  it("keeps the model's question and trims it", () => {
    expect(clarifyQuestion("  Which course?  ")).toBe("Which course?");
  });

  it("falls back to the honest stock question when the model wrote nothing", () => {
    expect(clarifyQuestion("   ")).toContain("which topic");
  });
});

describe("emptyWriteText", () => {
  it("distinguishes found-but-cut-off from found-nothing", () => {
    expect(emptyWriteText(true)).toContain("sources below");
    expect(emptyWriteText(false)).toContain("couldn't find anything");
  });
});

describe("lengthNoticePart", () => {
  it("is a fallback-action text part naming the length limit", () => {
    expect(lengthNoticePart()).toEqual({
      type: "text",
      action: "fallback",
      text: "That answer was cut short by the length limit, try asking a more specific question.",
    });
  });
});

const usage = () => ({
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
});

function writeModel(
  deltas: string[],
  unified: "stop" | "length" = "stop"
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
              finishReason: { unified, raw: unified },
              usage: usage(),
            },
          ],
        }),
        // The mock boundary cast, as in actions.test.ts: the chunk union does
        // not unify with the SDK's part type.
      }) as any,
  });
}

describe("runWritePhase", () => {
  it("streams the text to the wire and returns the accumulated whole", async () => {
    const events: RuntimeEvent[] = [];
    const result = await runWritePhase({
      chatModel: writeModel(["Hello ", "world."]),
      system: "write",
      messages: [{ role: "user", content: "hi" }],
      streaming: true,
      emit: (e) => events.push(e),
    });
    expect(result).toEqual({ text: "Hello world.", finishReason: "stop" });
    expect(events).toEqual([
      { type: "text-start", action: "search_knowledge" },
      { type: "text-delta", delta: "Hello " },
      { type: "text-delta", delta: "world." },
      { type: "text-end" },
    ]);
  });

  it("collects silently when streaming is off (the clarify case)", async () => {
    const events: RuntimeEvent[] = [];
    const result = await runWritePhase({
      chatModel: writeModel(["Which one?"]),
      system: "write",
      messages: [{ role: "user", content: "hi" }],
      streaming: false,
      emit: (e) => events.push(e),
    });
    expect(result.text).toBe("Which one?");
    expect(events).toEqual([]);
  });

  it("reports the length cutoff and records usage", async () => {
    const recorded: Array<{ inputTokens: number; outputTokens: number }> = [];
    const result = await runWritePhase({
      chatModel: writeModel(["Truncat"], "length"),
      system: "write",
      messages: [{ role: "user", content: "hi" }],
      streaming: true,
      emit: () => {},
      recordUsage: (u) => recorded.push(u),
    });
    expect(result.finishReason).toBe("length");
    expect(recorded).toEqual([{ inputTokens: 10, outputTokens: 5 }]);
  });

  it("never opens a text bubble when the model writes nothing", async () => {
    const events: RuntimeEvent[] = [];
    const result = await runWritePhase({
      chatModel: writeModel([]),
      system: "write",
      messages: [{ role: "user", content: "hi" }],
      streaming: true,
      emit: (e) => events.push(e),
    });
    expect(result.text).toBe("");
    expect(events).toEqual([]);
  });
});

/**
 * The endings this phase hands `runAgenticSearch`, each driven from a real
 * stream outcome through to the copy it produces: what the model did (wrote a
 * question / wrote nothing / was cut off) has to reach the right words, and
 * that wiring is what used to need a full agent-loop round trip.
 */
describe("the write phase's terminal endings", () => {
  async function endingFor(
    deltas: string[],
    opts: { unified?: "stop" | "length"; hasSources?: boolean } = {}
  ) {
    const result = await runWritePhase({
      chatModel: writeModel(deltas, opts.unified ?? "stop"),
      system: "write",
      messages: [{ role: "user", content: "hi" }],
      streaming: true,
      emit: () => {},
    });
    return resolveWriteEnding(result, opts.hasSources ?? false);
  }

  it("keeps what the model wrote, with no fallback and no notice", async () => {
    const ending = await endingFor(["A full ", "answer."]);
    expect(ending).toEqual({
      text: "A full answer.",
      fellBack: false,
      lengthNotice: null,
    });
  });

  it("stands in for an empty write, and says sources were found", async () => {
    const ending = await endingFor([], { hasSources: true });
    expect(ending.fellBack).toBe(true);
    expect(ending.text).toContain("sources below");
    expect(ending.lengthNotice).toBeNull();
  });

  it("stands in for an empty write with nothing found, and says so", async () => {
    const ending = await endingFor(["   "], { hasSources: false });
    expect(ending.fellBack).toBe(true);
    expect(ending.text).toContain("couldn't find anything");
  });

  it("appends the length notice when the stream was cut off", async () => {
    const ending = await endingFor(["Half an ans"], { unified: "length" });
    expect(ending.text).toBe("Half an ans");
    expect(ending.fellBack).toBe(false);
    expect(ending.lengthNotice).toMatchObject({
      type: "text",
      action: "fallback",
      text: expect.stringContaining("cut short by the length limit"),
    });
  });

  it("turns a clarify stream that wrote nothing into the stock question", async () => {
    const { text } = await runWritePhase({
      chatModel: writeModel(["   "]),
      system: "write",
      messages: [{ role: "user", content: "hi" }],
      streaming: false,
      emit: () => {},
    });
    expect(clarifyQuestion(text)).toContain("which topic");
  });

  it("keeps a clarify stream's own question", async () => {
    const { text } = await runWritePhase({
      chatModel: writeModel(["Which release?"]),
      system: "write",
      messages: [{ role: "user", content: "hi" }],
      streaming: false,
      emit: () => {},
    });
    expect(clarifyQuestion(text)).toBe("Which release?");
  });
});
