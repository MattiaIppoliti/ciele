import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "./types";
import {
  consumeTurnStream,
  decodeRuntimeEvents,
  type TurnView,
} from "./stream";

/**
 * The client side of the RuntimeEvent wire contract: ndjson decoding
 * (including partial-line buffering) and the fold from events to the
 * TurnView both chat UIs render.
 */

function bodyFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function ndjson(events: RuntimeEvent[]): string {
  return events.map((e) => JSON.stringify(e) + "\n").join("");
}

const collect = async (body: ReadableStream<Uint8Array>) => {
  const events: RuntimeEvent[] = [];
  for await (const event of decodeRuntimeEvents(body)) events.push(event);
  return events;
};

describe("decodeRuntimeEvents", () => {
  const events: RuntimeEvent[] = [
    { type: "notice", label: "Classifying" },
    { type: "text-delta", delta: "Hello" },
    { type: "done", conversationId: "c1", messageId: "m1" },
  ];

  it("decodes one JSON event per line", async () => {
    expect(await collect(bodyFromChunks([ndjson(events)]))).toEqual(events);
  });

  it("buffers lines split across chunk boundaries", async () => {
    const raw = ndjson(events);
    const chunks = [raw.slice(0, 17), raw.slice(17, 41), raw.slice(41)];
    expect(await collect(bodyFromChunks(chunks))).toEqual(events);
  });

  it("flushes a trailing event with no final newline", async () => {
    const raw = ndjson(events).trimEnd();
    expect(await collect(bodyFromChunks([raw]))).toEqual(events);
  });
});

describe("consumeTurnStream", () => {
  async function runTurn(
    events: RuntimeEvent[],
    options: { errorText?: (m: string) => string } = {}
  ) {
    let view: TurnView = {
      flowName: null,
      steps: [],
      parts: [],
      streamingText: null,
      phase: "running",
      searchCount: 0,
      iteration: null,
      iterationLimit: null,
      terminal: null,
    };
    let done: { conversationId: string; messageId: string | null } | null =
      null;
    let startedConversationId: string | null = null;
    await consumeTurnStream(bodyFromChunks([ndjson(events)]), {
      update: (fn) => {
        view = fn(view);
      },
      onDone: (d) => {
        done = d;
      },
      onStart: ({ conversationId }) => {
        startedConversationId = conversationId;
      },
      ...options,
    });
    return { view, done, startedConversationId };
  }

  it("exposes the conversation id before generation completes so a turn can be steered", async () => {
    const result = await runTurn([
      { type: "turn", conversationId: "c-early" },
      { type: "text-start", action: "search_knowledge" },
      { type: "text-delta", delta: "partial" },
    ]);
    expect(result.startedConversationId).toBe("c-early");
  });

  it("folds a full turn: flow, steps, streamed text, parts, done", async () => {
    const { view, done } = await runTurn([
      { type: "flow", flowId: "f1", flowName: "Default behavior", isDefault: true },
      { type: "notice", label: "Classifying" },
      {
        type: "tool-start",
        callId: "t1",
        tool: "searchKnowledge",
        label: "Searching",
      },
      {
        type: "tool-end",
        callId: "t1",
        tool: "searchKnowledge",
        ok: true,
        durationMs: 5,
      },
      { type: "text-start", action: "search_knowledge" },
      { type: "text-delta", delta: "Hel" },
      { type: "text-delta", delta: "lo" },
      { type: "text-end" },
      {
        type: "part",
        part: { type: "follow_ups", action: "follow_up_questions", questions: ["Q"] },
      },
      { type: "done", conversationId: "c1", messageId: "m1" },
    ]);

    expect(view.flowName).toBe("Default behavior");
    expect(view.steps.map((s) => s.label)).toEqual(["Classifying", "Searching"]);
    expect(view.steps.every((s) => s.status === "done")).toBe(true);
    expect(view.streamingText).toBeNull(); // solidified on text-end
    expect(view.parts).toEqual([
      { type: "text", action: "search_knowledge", text: "Hello" },
      { type: "follow_ups", action: "follow_up_questions", questions: ["Q"] },
    ]);
    expect(done).toEqual({ conversationId: "c1", messageId: "m1" });
    expect(view.phase).toBe("done");
    expect(view.searchCount).toBe(1);
  });

  it("stays running until the turn reaches its answer", async () => {
    const phases = async (events: RuntimeEvent[]) => (await runTurn(events)).view.phase;
    const search = (callId: string): RuntimeEvent => ({
      type: "tool-start",
      callId,
      tool: "searchKnowledge",
      label: "Searching",
    });

    // Work in flight — the panel spins and stays open.
    expect(await phases([{ type: "notice", label: "Classifying" }])).toBe("running");
    expect(await phases([search("t1")])).toBe("running");
    expect(await phases([{ type: "thought", text: "hmm" }])).toBe("running");

    // Only knowledge searches feed the ×N pill.
    const { view } = await runTurn([search("t1"), search("t2")]);
    expect(view.searchCount).toBe(2);
    expect(
      (await runTurn([{ type: "tool-start", callId: "t3", tool: "remember", label: "Saving" }]))
        .view.searchCount
    ).toBe(0);

    // Text streamed after a search is the answer, so the turn is done; before
    // one it may still be pre-tool reasoning a `thought` event reclassifies.
    expect(
      await phases([search("t1"), { type: "text-start", action: "search_knowledge" }])
    ).toBe("done");
    expect(await phases([{ type: "text-start", action: "search_knowledge" }])).toBe(
      "running"
    );
    expect(await phases([{ type: "text-end" }])).toBe("done");
  });

  it("carries a notice event's detail into the step", async () => {
    const { view } = await runTurn([
      { type: "notice", label: "Classifying intent", detail: "Matched flow “Billing”" },
    ]);
    expect(view.steps[0].kind).toBe("notice");
    expect(view.steps[0].detail).toBe("Matched flow “Billing”");
  });

  it("keeps streamingText live between deltas", async () => {
    const { view } = await runTurn([
      { type: "text-start", action: "search_knowledge" },
      { type: "text-delta", delta: "partial" },
    ]);
    expect(view.streamingText).toBe("partial");
    expect(view.parts).toEqual([]);
  });

  it("folds a thought: streamed reasoning moves into steps, answer restarts", async () => {
    const { view } = await runTurn([
      { type: "notice", label: "Classifying" },
      // The agent starts "answering", then decides to call a tool: the
      // streamed text was reasoning and must move to the Thinking panel.
      { type: "text-start", action: "search_knowledge" },
      { type: "text-delta", delta: "I'll look that up." },
      { type: "thought", text: "I'll look that up." },
      {
        type: "tool-start",
        callId: "t1",
        tool: "searchKnowledge",
        label: "Searching knowledge",
      },
      { type: "text-start", action: "search_knowledge" },
      { type: "text-delta", delta: "Here is the answer." },
      { type: "text-end" },
    ]);
    expect(view.steps.map((s) => s.label)).toEqual([
      "Classifying",
      "I'll look that up.",
      "Searching knowledge",
    ]);
    expect(view.steps[1].kind).toBe("thought");
    expect(view.parts).toEqual([
      { type: "text", action: "search_knowledge", text: "Here is the answer." },
    ]);
    expect(view.streamingText).toBeNull();
  });

  it("folds tool-start/tool-end into one step with lifecycle status", async () => {
    const running = await runTurn([
      {
        type: "tool-start",
        callId: "call-1",
        tool: "searchKnowledge",
        label: "Searching knowledge for “fees”",
        input: { query: "fees" },
      },
    ]);
    expect(running.view.steps).toEqual([
      {
        id: "call-1",
        kind: "tool",
        tool: "searchKnowledge",
        label: "Searching knowledge for “fees”",
        input: { query: "fees" },
        status: "running",
      },
    ]);

    const finished = await runTurn([
      {
        type: "tool-start",
        callId: "call-1",
        tool: "searchKnowledge",
        label: "Searching knowledge for “fees”",
      },
      {
        type: "tool-end",
        callId: "call-1",
        tool: "searchKnowledge",
        ok: true,
        summary: "Found 3 relevant concepts",
        durationMs: 42,
      },
    ]);
    expect(finished.view.steps).toEqual([
      {
        id: "call-1",
        kind: "tool",
        tool: "searchKnowledge",
        label: "Searching knowledge for “fees”",
        status: "done",
        detail: "Found 3 relevant concepts",
        durationMs: 42,
      },
    ]);
  });

  it("marks a failed tool call as an error step", async () => {
    const { view } = await runTurn([
      { type: "tool-start", callId: "c9", tool: "fetchUrl", label: "Fetching x" },
      {
        type: "tool-end",
        callId: "c9",
        tool: "fetchUrl",
        ok: false,
        summary: "Request failed with status 500",
        durationMs: 7,
      },
    ]);
    expect(view.steps[0]).toMatchObject({
      status: "error",
      detail: "Request failed with status 500",
    });
  });

  it("degrades an error event to a fallback part (default text)", async () => {
    const { view } = await runTurn([{ type: "error", message: "boom" }]);
    expect(view.parts[0]).toMatchObject({
      type: "text",
      action: "fallback",
      text: "Something went wrong — please try again.",
    });
  });

  it("uses the caller's errorText renderer when given", async () => {
    const { view } = await runTurn([{ type: "error", message: "boom" }], {
      errorText: (m) => `⚠️ ${m}`,
    });
    expect(view.parts[0]).toMatchObject({ text: "⚠️ boom" });
  });
});
