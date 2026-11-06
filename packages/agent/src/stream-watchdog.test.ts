import { describe, expect, it } from "vitest";
import { simulateReadableStream, streamText, wrapLanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { ProviderStreamStalledError, streamWatchdogMiddleware } from "./stream-watchdog";

const usage = {
  inputTokens: { total: 4, noCache: 4, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
};

const finished = [
  { type: "stream-start" as const, warnings: [] },
  { type: "text-start" as const, id: "1" },
  { type: "text-delta" as const, id: "1", delta: "Hello" },
  { type: "text-end" as const, id: "1" },
  { type: "finish" as const, finishReason: { unified: "stop" as const, raw: "stop" }, usage },
];

/** A body that sends `chunks` and then goes silent without closing. */
function stalling(chunks: unknown[]) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
    },
  });
}

function scripted(streams: Array<() => ReadableStream>) {
  let call = 0;
  return new MockLanguageModelV3({
    // The mock boundary cast, as in gather-phase.test.ts.
    doStream: async () => ({ stream: streams[call++]!() }) as any,
  });
}

async function run(model: MockLanguageModelV3, idleMs = 30) {
  const errors: unknown[] = [];
  const result = streamText({
    model: wrapLanguageModel({ model, middleware: streamWatchdogMiddleware({ idleMs, retries: 1 }) }),
    prompt: "hi",
    onError: ({ error }) => {
      errors.push(error);
    },
  });
  let text = "";
  for await (const chunk of result.fullStream) {
    if (chunk.type === "text-delta") text += chunk.text;
  }
  return { text, errors };
}

describe("streamWatchdogMiddleware", () => {
  it("passes a healthy stream through untouched", async () => {
    const model = scripted([() => simulateReadableStream({ chunks: finished })]);
    const { text, errors } = await run(model);
    expect(text).toBe("Hello");
    expect(errors).toEqual([]);
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("retries once when the stream stalls before any content", async () => {
    const model = scripted([
      () => stalling([{ type: "stream-start", warnings: [] }]),
      () => simulateReadableStream({ chunks: finished }),
    ]);
    const { text, errors } = await run(model);
    // The stalled attempt's stream-start is withheld, so the retry cannot
    // duplicate anything the caller saw.
    expect(text).toBe("Hello");
    expect(errors).toEqual([]);
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it("fails with a stall error, never a retry, once content has streamed", async () => {
    const model = scripted([
      () =>
        stalling([
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "1" },
          { type: "text-delta", id: "1", delta: "Hel" },
        ]),
      () => simulateReadableStream({ chunks: finished }),
    ]);
    const { text, errors } = await run(model);
    expect(text).toBe("Hel");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ProviderStreamStalledError);
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("gives up with a stall error when the retry stalls too", async () => {
    const model = scripted([
      () => stalling([{ type: "stream-start", warnings: [] }]),
      () => stalling([]),
    ]);
    const { errors } = await run(model);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ProviderStreamStalledError);
    expect(model.doStreamCalls).toHaveLength(2);
  });
});
