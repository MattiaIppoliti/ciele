import { describe, expect, it } from "vitest";
import { generateText, simulateReadableStream, stepCountIs, streamText, tool, wrapLanguageModel } from "ai";
import { z } from "zod";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { RuntimeEventInput, TurnTimings } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { recordRuntimeEvent } from "./telemetry";
import {
  TurnClock,
  activeTurnClock,
  timedDb,
  timedSync,
  timedWait,
  turnClockMiddleware,
  unionMs,
  withModelStage,
  withTurnClock,
} from "./turn-clock";
import { createTurnObserver } from "./turn-observer";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));


const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};
const finish = { type: "finish" as const, finishReason: { unified: "stop" as const, raw: "stop" }, usage };

function textChunks(text: string): LanguageModelV4StreamPart[] {
  return [
    { type: "text-start" as const, id: "t" },
    { type: "text-delta" as const, id: "t", delta: text },
    { type: "text-end" as const, id: "t" },
    finish,
  ];
}

/** A model that streams `chunks` 15 ms apart, timed by the clock middleware. */
function clockedStreamModel(steps: LanguageModelV4StreamPart[][]) {
  let call = 0;
  return wrapLanguageModel({
    model: new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream<LanguageModelV4StreamPart>({
          initialDelayInMs: 0,
          chunkDelayInMs: 15,
          chunks: steps[Math.min(call++, steps.length - 1)]!,
        }),
      }),
      doGenerate: async () => {
        await sleep(30);
        return {
          content: [{ type: "text", text: "ok" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          warnings: [],
        };
      },
    }),
    middleware: [turnClockMiddleware()],
  });
}

describe("unionMs", () => {
  it("counts overlapping intervals once and gaps not at all", () => {
    expect(unionMs([])).toBe(0);
    expect(unionMs([[0, 10]])).toBe(10);
    expect(unionMs([[0, 10], [5, 20]])).toBe(20);
    expect(unionMs([[30, 40], [0, 10]])).toBe(20);
    expect(unionMs([[0, 50], [10, 20], [60, 70]])).toBe(60);
  });
});

describe("turn clock", () => {
  it("records nothing and changes nothing outside a scope", async () => {
    expect(activeTurnClock()).toBeUndefined();
    await expect(timedWait("embed", async () => 7)).resolves.toBe(7);
  });

  it("unions parallel waits of one kind and across kinds", async () => {
    const clock = new TurnClock();
    await withTurnClock(clock, async () => {
      await Promise.all([
        timedWait("model", () => sleep(40)),
        timedWait("model", () => sleep(40)),
        timedWait("embed", () => sleep(40)),
      ]);
    });
    const timings = clock.summary();
    expect(timings.modelCalls).toBe(2);
    // Two 40 ms calls side by side are ~40 ms of model wait, not 80.
    expect(timings.modelMs).toBeGreaterThanOrEqual(35);
    expect(timings.modelMs).toBeLessThan(75);
    expect(timings.waitMs).toBeLessThan(75);
    expect(timings.embedMs).toBeGreaterThanOrEqual(35);
    expect(timings.firstTokenMs).toBeNull();
  });

  it("records a failed wait too", async () => {
    const clock = new TurnClock();
    await withTurnClock(clock, () =>
      timedWait("rerank", async () => {
        await sleep(20);
        throw new Error("timeout");
      }).catch(() => undefined)
    );
    expect(clock.summary().rerankMs).toBeGreaterThanOrEqual(15);
  });

  it("counts turns that share the process while it runs", async () => {
    const first = new TurnClock();
    const second = new TurnClock();
    let release: () => void = () => {};
    const firstDone = new Promise<void>((resolve) => (release = resolve));
    withTurnClock(first, () => undefined, { settled: firstDone });
    withTurnClock(second, () => undefined);
    release();
    await firstDone;
    expect(first.overlap).toBe(2);
    expect(second.overlap).toBe(2);
    const alone = new TurnClock();
    withTurnClock(alone, () => undefined);
    expect(alone.overlap).toBe(1);
  });

  it("times a Db's async methods and keeps them bound to the adapter", async () => {
    class Adapter {
      #rows = ["a"];
      async listThings() {
        await sleep(20);
        return this.#rows;
      }
      name() {
        return "sync";
      }
    }
    const db = timedDb(new Adapter() as unknown as Db) as unknown as Adapter;
    const clock = new TurnClock();
    const rows = await withTurnClock(clock, () => db.listThings());
    expect(rows).toEqual(["a"]);
    expect(db.name()).toBe("sync");
    expect(clock.summary().dbMs).toBeGreaterThanOrEqual(15);
  });

  it("times a streamed model call until the stream ends, one wait per step", async () => {
    const model = wrapLanguageModel({
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: simulateReadableStream({
            initialDelayInMs: 0,
            chunkDelayInMs: 15,
            chunks: [
              { type: "text-start", id: "t" },
              { type: "text-delta", id: "t", delta: "Hello" },
              { type: "text-delta", id: "t", delta: " there" },
              { type: "text-end", id: "t" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: "stop" },
                usage: {
                  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 2, text: 2, reasoning: 0 },
                },
              },
            ],
          }),
        }),
      }),
      middleware: [turnClockMiddleware()],
    });
    const clock = new TurnClock();
    await withTurnClock(clock, async () => {
      const result = streamText({ model, prompt: "hi" });
      await result.consumeStream();
    });
    const timings = clock.summary();
    expect(timings.modelCalls).toBe(1);
    // Five chunks 15 ms apart: the whole stream, not just its first byte.
    expect(timings.modelMs).toBeGreaterThanOrEqual(60);
  });

  it("files model time under the ai_usage stage that ran it, generate when unscoped", async () => {
    const model = clockedStreamModel([textChunks("hi")]);
    const clock = new TurnClock();
    await withTurnClock(clock, async () => {
      await withModelStage("classify", () => generateText({ model, prompt: "route" }));
      await generateText({ model, prompt: "answer" });
    });
    const timings = clock.summary();
    expect(timings.modelCalls).toBe(2);
    expect(timings.modelMsByStage.classify).toBeGreaterThanOrEqual(25);
    expect(timings.modelMsByStage.generate).toBeGreaterThanOrEqual(25);
    expect(timings.modelMs).toBeGreaterThanOrEqual(50);
  });

  it("still records a streamed model call the reader cancels", async () => {
    const model = clockedStreamModel([
      [...textChunks("one"), ...textChunks("two"), ...textChunks("three")],
    ]);
    const clock = new TurnClock();
    await withTurnClock(clock, async () => {
      const { stream } = await model.doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] });
      const reader = stream.getReader();
      await reader.read();
      await reader.read();
      await reader.cancel("visitor left");
    });
    const timings = clock.summary();
    expect(timings.modelCalls).toBe(1);
    expect(timings.modelMs).toBeGreaterThanOrEqual(10);
  });

  it("reaches every step of a streamed agent loop run inside a ReadableStream's start, read from outside the scope", async () => {
    const model = clockedStreamModel([
      [
        { type: "tool-call", toolCallId: "c1", toolName: "lookup", input: JSON.stringify({ q: "x" }) },
        { ...finish, finishReason: { unified: "tool-calls", raw: "tool_calls" } },
      ],
      textChunks("answer"),
    ]);
    const recorded: RuntimeEventInput[] = [];
    const db = {
      recordRuntimeEvent: async (event: RuntimeEventInput) => {
        recorded.push(event);
      },
    } as unknown as Db;
    const clock = new TurnClock();
    // The turn's shape: the work runs in `start`, the host reads the bytes
    // from a request handler that is not inside the clock's scope.
    const body = withTurnClock(clock, () =>
      new ReadableStream<string>({
        async start(controller) {
          const observer = createTurnObserver(() => undefined);
          const result = streamText({
            model,
            prompt: "hi",
            stopWhen: stepCountIs(3),
            tools: {
              lookup: tool({
                inputSchema: z.object({ q: z.string() }),
                execute: async () => {
                  const started = Date.now();
                  await sleep(20);
                  observer.emit({ type: "tool-end", callId: "c1", tool: "lookup", ok: true, durationMs: Date.now() - started });
                  return { found: true };
                },
              }),
            },
          });
          for await (const delta of result.textStream) controller.enqueue(delta);
          await recordRuntimeEvent(db, { organizationId: "o", kind: "chat_turn", status: "succeeded" });
          controller.close();
        },
      })
    );
    expect(activeTurnClock()).toBeUndefined();
    expect(await new Response(body.pipeThrough(new TextEncoderStream())).text()).toBe("answer");
    const timings = recorded[0]?.timings as TurnTimings | undefined;
    expect(timings?.modelCalls).toBe(2);
    expect(timings?.modelMsByStage.generate).toBeGreaterThan(0);
    expect(timings?.tools.lookup).toMatchObject({ calls: 1 });
    expect(timings?.toolMs).toBeGreaterThanOrEqual(15);
  });

  it("counts a tool call once however many observers see its end", () => {
    const clock = new TurnClock();
    withTurnClock(clock, () => {
      clock.toolEnd("c1", "searchKnowledge", 40);
      clock.toolEnd("c1", "searchKnowledge", 40);
      clock.toolEnd("c2", "searchKnowledge", 10);
    });
    expect(clock.summary().tools).toEqual({ searchKnowledge: { calls: 2, ms: expect.any(Number) } });
  });

  it("times vector search apart from other Db calls", async () => {
    const db = timedDb({
      searchChunks: async () => {
        await sleep(30);
        return [];
      },
      listFlows: async () => [],
    } as unknown as Db);
    const clock = new TurnClock();
    await withTurnClock(clock, async () => {
      await db.searchChunks("a", null, { text: "q", embedding: null, limit: 6 } as never);
      await db.listFlows("a");
    });
    const timings = clock.summary();
    expect(timings.retrievalMs).toBeGreaterThanOrEqual(25);
    expect(timings.dbMs).toBeLessThan(25);
  });

  it("keeps individual model and tool durations when calls overlap", () => {
    const clock = new TurnClock(0);
    clock.modelWait("classify", 10, 30);
    clock.modelWait("classify", 20, 50);
    clock.toolEnd("one", "lookup", 40, 60);
    clock.toolEnd("two", "lookup", 30, 70);
    const timings = clock.summary();
    expect(timings.modelMsByStage.classify).toBe(40);
    expect(timings.modelCallTimings).toEqual([
      { stage: "classify", ms: 20 }, { stage: "classify", ms: 30 },
    ]);
    expect(timings.tools.lookup).toEqual({ calls: 2, ms: 50 });
    expect(timings.toolCallTimings).toEqual([
      { tool: "lookup", ms: 40 }, { tool: "lookup", ms: 30 },
    ]);
  });

  it("stops counting a clock nobody settles after its maximum lifetime", async () => {
    withTurnClock(new TurnClock(), () => undefined, {
      settled: new Promise(() => {}),
      maxLiveMs: 20,
    });
    const during = new TurnClock();
    withTurnClock(during, () => undefined);
    expect(during.overlap).toBe(2);
    await sleep(40);
    const after = new TurnClock();
    withTurnClock(after, () => undefined);
    expect(after.overlap).toBe(1);
  });

  it("counts in-flight jobs in a turn's overlap, and says how many were jobs", async () => {
    let finishJob: () => void = () => {};
    const job = withTurnClock(new TurnClock(undefined, "job"), () => new Promise<void>((resolve) => (finishJob = resolve)));
    const turn = new TurnClock();
    withTurnClock(turn, () => undefined);
    expect(turn.summary()).toMatchObject({ overlap: 2, jobsInFlight: 1, trigger: "live" });
    finishJob();
    await job;
    const alone = new TurnClock();
    withTurnClock(alone, () => undefined);
    expect(alone.summary()).toMatchObject({ overlap: 1, jobsInFlight: 0 });
  });

  it("does not put a job's clock on a chat_turn event", async () => {
    const recorded: RuntimeEventInput[] = [];
    const db = {
      recordRuntimeEvent: async (event: RuntimeEventInput) => {
        recorded.push(event);
      },
    } as unknown as Db;
    await withTurnClock(new TurnClock(undefined, "job"), () =>
      recordRuntimeEvent(db, { organizationId: "o", kind: "chat_turn", status: "succeeded" })
    );
    expect(recorded[0]?.timings).toBeUndefined();
  });

  it("summarises an ingest job's parse, chunk and embed time", async () => {
    const clock = new TurnClock(undefined, "job");
    await withTurnClock(clock, async () => {
      timedSync("parse", () => {
        const until = performance.now() + 15;
        while (performance.now() < until);
      });
      timedSync("chunk", () => "a\n\nb".split("\n\n"));
      await timedWait("embed", () => sleep(20));
      clock.countConcepts(2);
    });
    const timings = clock.ingestSummary();
    expect(timings.parseMs).toBeGreaterThanOrEqual(14);
    expect(timings.embedMs).toBeGreaterThanOrEqual(15);
    expect(timings.concepts).toBe(2);
    expect(timings.waitMs).toBeGreaterThanOrEqual(timings.parseMs + timings.embedMs - 1);
  });

  it("puts the summary on a chat_turn event and only on one", async () => {
    const recorded: RuntimeEventInput[] = [];
    const db = {
      recordRuntimeEvent: async (event: RuntimeEventInput) => {
        recorded.push(event);
      },
    } as unknown as Db;
    const clock = new TurnClock();
    await withTurnClock(clock, async () => {
      clock.markFirstToken();
      await recordRuntimeEvent(db, { organizationId: "o", kind: "chat_turn", status: "succeeded" });
      await recordRuntimeEvent(db, { organizationId: "o", kind: "crawl", status: "succeeded" });
    });
    await recordRuntimeEvent(db, { organizationId: "o", kind: "chat_turn", status: "failed" });
    expect((recorded[0]?.timings as TurnTimings | undefined)?.firstTokenMs).toBeTypeOf("number");
    expect(recorded[1]?.timings).toBeUndefined();
    expect(recorded[2]?.timings).toBeUndefined();
  });
});
