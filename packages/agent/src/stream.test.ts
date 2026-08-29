import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "./types";
import {
  appendOrReplacePart,
  consumeTurnStream,
  decodeRuntimeEvents,
  dropPendingComponents,
  foldTraceEvent,
  updatePendingComponent,
  EMPTY_TURN_TRACE,
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

/** Drives a whole turn through the consumer and returns what a client would hold. */
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
  const views: TurnView[] = [];
  await consumeTurnStream(bodyFromChunks([ndjson(events)]), {
    update: (fn) => {
      view = fn(view);
      views.push(view);
    },
    onDone: (d) => {
      done = d;
    },
    onStart: ({ conversationId }) => {
      startedConversationId = conversationId;
    },
    ...options,
  });
  return { view, views, done, startedConversationId };
}

/**
 * The last provisional component any snapshot held. A pending component never
 * survives the consumer (it is swept when the turn ends, however it ends), so
 * the growing render can only be observed mid-stream.
 */
function lastPendingComponent(views: readonly TurnView[]) {
  for (let i = views.length - 1; i >= 0; i -= 1) {
    const part = views[i].parts.find(
      (candidate) => candidate.type === "component" && candidate.pending
    );
    if (part) return part as Extract<typeof part, { type: "component" }>;
  }
  return undefined;
}

describe("consumeTurnStream", () => {
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

    // Work in flight: the panel spins and stays open.
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

  it("streams a thought live: deltas build a running step the terminal thought finalizes", async () => {
    // Mid-stream (deltas only): the reasoning is already a visible running step,
    // so the Thinking panel shows it while the model is still writing it.
    const streaming = await runTurn([
      { type: "thought-delta", delta: "Sto cercando " },
      { type: "thought-delta", delta: "i video del corso." },
    ]);
    expect(streaming.view.steps).toHaveLength(1);
    expect(streaming.view.steps[0]).toMatchObject({
      kind: "thought",
      status: "running",
      label: "Sto cercando i video del corso.",
    });
    expect(streaming.view.phase).toBe("running");

    // The terminal thought reconciles that same step with the authoritative
    // (trimmed) text instead of appending a duplicate.
    const { view } = await runTurn([
      { type: "thought-delta", delta: "Sto cercando " },
      { type: "thought-delta", delta: "i video del corso.\n" },
      { type: "thought", text: "Sto cercando i video del corso." },
      { type: "tool-start", callId: "t1", tool: "searchKnowledge", label: "Searching" },
    ]);
    expect(view.steps.map((s) => [s.kind, s.status, s.label])).toEqual([
      ["thought", "done", "Sto cercando i video del corso."],
      ["tool", "running", "Searching"],
    ]);
  });

  it("folds the same steps whether a thought arrives as deltas or terminal-only", async () => {
    // Back-compat: stored traces and older streams carry only terminal thought
    // events; both roads must produce the identical persisted step.
    const fromDeltas = await runTurn([
      { type: "thought-delta", delta: "Reformulating " },
      { type: "thought-delta", delta: "the query." },
      { type: "thought", text: "Reformulating the query." },
    ]);
    const terminalOnly = await runTurn([
      { type: "thought", text: "Reformulating the query." },
    ]);
    expect(fromDeltas.view.steps).toEqual(terminalOnly.view.steps);
  });

  it("starts a new running thought after the previous one was finalized", async () => {
    const { view } = await runTurn([
      { type: "thought-delta", delta: "First." },
      { type: "thought", text: "First." },
      { type: "tool-start", callId: "t1", tool: "searchKnowledge", label: "Searching" },
      { type: "tool-end", callId: "t1", tool: "searchKnowledge", ok: true, durationMs: 3 },
      { type: "thought-delta", delta: "Second." },
    ]);
    expect(view.steps.map((s) => [s.kind, s.status])).toEqual([
      ["thought", "done"],
      ["tool", "done"],
      ["thought", "running"],
    ]);
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
      text: "Something went wrong, please try again.",
    });
  });

  it("uses the caller's errorText renderer when given", async () => {
    const { view } = await runTurn([{ type: "error", message: "boom" }], {
      errorText: (m) => `⚠️ ${m}`,
    });
    expect(view.parts[0]).toMatchObject({ text: "⚠️ boom" });
  });
});

/**
 * Progressive component rendering: a render-only tool's arguments ARE its
 * component's props, so the client grows the component from the argument
 * deltas and replaces it with the validated part. The invariant under test is
 * that the two never coexist and the streamed one never survives.
 */
describe("streamed component props", () => {
  const props = { title: "Piani", columns: ["Piano"], rows: [["Pro"]] };
  const finished: RuntimeEvent = {
    type: "part",
    part: {
      type: "component",
      action: "search_knowledge",
      name: "table",
      callId: "t9",
      props,
    },
  };

  it("opens an empty component, then grows it from the deltas", async () => {
    const raw = JSON.stringify(props);
    const { views } = await runTurn([
      { type: "tool-input-start", callId: "t9", tool: "renderTable", name: "table" },
      { type: "tool-input-delta", callId: "t9", delta: raw.slice(0, 18) },
      { type: "tool-input-delta", callId: "t9", delta: raw.slice(18) },
    ]);
    expect(lastPendingComponent(views)).toMatchObject({
      type: "component",
      name: "table",
      callId: "t9",
      pending: true,
      props,
    });
  });

  it("holds the last good parse while a fragment is incoherent", async () => {
    const { views } = await runTurn([
      { type: "tool-input-start", callId: "t9", tool: "renderTable", name: "table" },
      { type: "tool-input-delta", callId: "t9", delta: '{"title":"Piani"' },
      // A dangling key: nothing new to show, and blanking would be worse.
      { type: "tool-input-delta", callId: "t9", delta: ',"colu' },
    ]);
    expect(lastPendingComponent(views)).toMatchObject({
      props: { title: "Piani" },
    });
  });

  it("replaces the provisional render in place, and clears pending", async () => {
    const { view } = await runTurn([
      { type: "tool-input-start", callId: "t9", tool: "renderTable", name: "table" },
      { type: "tool-input-delta", callId: "t9", delta: '{"title":"Pia' },
      finished,
      { type: "tool-end", callId: "t9", tool: "renderTable", ok: true, durationMs: 2 },
    ]);
    expect(view.parts).toHaveLength(1);
    expect(view.parts[0]).toEqual({
      type: "component",
      action: "search_knowledge",
      name: "table",
      callId: "t9",
      props,
    });
  });

  it("renders whole when the provider never streams arguments", async () => {
    // Google needs `streamFunctionCallArguments` to send them at all, so this
    // is the floor the feature degrades to, not an edge case.
    const { view } = await runTurn([
      { type: "tool-input-start", callId: "t9", tool: "renderTable", name: "table" },
      finished,
      { type: "tool-end", callId: "t9", tool: "renderTable", ok: true, durationMs: 2 },
    ]);
    expect(view.parts).toHaveLength(1);
    expect(view.parts[0]).not.toHaveProperty("pending");
  });

  it("strands nothing when the arguments never reach the tool", async () => {
    // Schema validation runs before execute, so an over-cap or malformed
    // payload emits neither tool-start nor tool-end. Without a sweep the
    // skeleton stayed on screen for the rest of the turn, never persisted.
    const { view } = await runTurn([
      { type: "tool-input-start", callId: "t9", tool: "renderTable", name: "table" },
      { type: "tool-input-delta", callId: "t9", delta: '{"columns":["A"]' },
      { type: "text-start", action: "search_knowledge" },
      { type: "text-delta", delta: "Ecco la risposta." },
      { type: "text-end" },
      { type: "done", conversationId: "c1", messageId: "m1" },
    ]);
    expect(view.parts.map((part) => part.type)).toEqual(["text"]);
  });

  it("never leaves a pending component in the view it returns", async () => {
    // The contract the three tests above have to read history for: whatever the
    // stream did, the consumer hands back no half-built component.
    const { view } = await runTurn([
      { type: "tool-input-start", callId: "t9", tool: "renderTable", name: "table" },
      { type: "tool-input-delta", callId: "t9", delta: '{"columns":["A"]' },
    ]);
    expect(view.parts).toEqual([]);
  });

  it("strands nothing when the stream is aborted mid-component", async () => {
    // The widget's catch swallows an abort, so a skeleton left behind would
    // pulse in the transcript for the rest of the session. No `done`, no
    // `error`: the iterator just throws.
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            ndjson([
              { type: "tool-input-start", callId: "t9", tool: "renderTable", name: "table" },
              { type: "tool-input-delta", callId: "t9", delta: '{"columns":["A"]' },
            ])
          )
        );
        controller.error(new Error("aborted"));
      },
    });
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
    await expect(
      consumeTurnStream(body, {
        update: (fn) => {
          view = fn(view);
        },
      })
    ).rejects.toThrow("aborted");
    expect(view.parts).toEqual([]);
  });

  it("strands nothing when the turn ends on an error", async () => {
    const { view } = await runTurn([
      { type: "tool-input-start", callId: "t9", tool: "renderTable", name: "table" },
      { type: "tool-input-delta", callId: "t9", delta: '{"columns":["A"]' },
      { type: "error", message: "boom" },
    ]);
    expect(view.parts.map((part) => part.type)).toEqual(["text"]);
  });

  it("keeps a settled component when the turn ends", async () => {
    // The sweep must take the skeletons and nothing else.
    const { view } = await runTurn([
      { type: "tool-input-start", callId: "t9", tool: "renderTable", name: "table" },
      finished,
      { type: "tool-end", callId: "t9", tool: "renderTable", ok: true, durationMs: 2 },
      { type: "done", conversationId: "c1", messageId: "m1" },
    ]);
    expect(view.parts).toHaveLength(1);
    expect(view.parts[0]).toMatchObject({ type: "component", props });
  });

  it("keeps the Simplified-thinking line out of the props", async () => {
    // `progress` rides the same argument JSON the deltas carry.
    const { views } = await runTurn([
      { type: "tool-input-start", callId: "t9", tool: "renderTable", name: "table" },
      {
        type: "tool-input-delta",
        callId: "t9",
        delta: '{"progress":"Sto preparando…","columns":["A"]}',
      },
    ]);
    const pendingPart = lastPendingComponent(views);
    expect(pendingPart).toMatchObject({ props: { columns: ["A"] } });
    expect(pendingPart?.props).not.toHaveProperty("progress");
  });

  it("drops the skeleton when the render tool refused the arguments", async () => {
    const { view } = await runTurn([
      { type: "tool-input-start", callId: "t9", tool: "renderTable", name: "table" },
      { type: "tool-input-delta", callId: "t9", delta: '{"columns":[' },
      { type: "tool-end", callId: "t9", tool: "renderTable", ok: false, durationMs: 2 },
    ]);
    expect(view.parts).toEqual([]);
  });

  it("keeps the component ahead of the answer text it refers to", async () => {
    const { view } = await runTurn([
      { type: "tool-input-start", callId: "t9", tool: "renderTable", name: "table" },
      finished,
      { type: "tool-end", callId: "t9", tool: "renderTable", ok: true, durationMs: 2 },
      { type: "text-start", action: "search_knowledge" },
      { type: "text-delta", delta: "Come vedi in tabella…" },
      { type: "text-end" },
    ]);
    expect(view.parts.map((part) => part.type)).toEqual(["component", "text"]);
  });

  it("leaves the persisted trace alone: argument deltas are not steps", () => {
    // The stored trace takes its component from the validated part; a partial
    // parse must never reach it, so the fold ignores both events outright.
    const trace = [
      { type: "tool-input-start", callId: "t9", tool: "renderTable", name: "table" },
      { type: "tool-input-delta", callId: "t9", delta: '{"title":"x"}' },
    ].reduce<typeof EMPTY_TURN_TRACE>(
      (acc, event) => foldTraceEvent(acc, event as RuntimeEvent),
      EMPTY_TURN_TRACE
    );
    expect(trace).toEqual(EMPTY_TURN_TRACE);
  });
});

/** The part-list rewrites, on their own: components are the only parts a client edits. */
describe("component part helpers", () => {
  const pending = {
    type: "component" as const,
    action: "search_knowledge" as const,
    name: "table" as const,
    callId: "t1",
    props: { columns: ["A"] },
    pending: true,
  };
  const text = { type: "text" as const, action: "search_knowledge" as const, text: "hi" };

  it("appends a part with no provisional twin", () => {
    expect(appendOrReplacePart([text], pending)).toEqual([text, pending]);
  });

  it("replaces by call id rather than appending a duplicate", () => {
    const final = { ...pending, pending: undefined, props: { columns: ["A", "B"] } };
    expect(appendOrReplacePart([text, pending], final)).toEqual([text, final]);
  });

  it("appends a component from a different call", () => {
    const other = { ...pending, callId: "t2" };
    expect(appendOrReplacePart([pending], other)).toHaveLength(2);
  });

  it("will not rewrite props once the validated part has landed", () => {
    const settled = { ...pending, pending: undefined };
    expect(updatePendingComponent([settled], "t1", { columns: ["Z"] })).toEqual([
      settled,
    ]);
  });

  it("drops only the pending component for that call", () => {
    const settled = { ...pending, callId: "t2", pending: undefined };
    expect(dropPendingComponents([text, pending, settled], "t1")).toEqual([
      text,
      settled,
    ]);
  });

  it("drops every pending component when given no call id", () => {
    const other = { ...pending, callId: "t2" };
    const settled = { ...pending, callId: "t3", pending: undefined };
    expect(dropPendingComponents([text, pending, other, settled])).toEqual([
      text,
      settled,
    ]);
  });
});
