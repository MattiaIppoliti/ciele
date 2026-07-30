import { describe, expect, it } from "vitest";
import { TRACE_MAX_STEPS, type TurnStep } from "@agent-hub/core";
import { EMPTY_TURN_TRACE, foldTraceEvent, type TurnTrace } from "./stream";
import { prepareTraceForStorage } from "./trace";

const traceOf = (steps: TurnStep[], searchCount = 0): TurnTrace => ({
  ...EMPTY_TURN_TRACE,
  steps,
  searchCount,
});

const tool = (over: Partial<TurnStep> = {}): TurnStep => ({
  id: "call-1",
  kind: "tool",
  tool: "searchKnowledge",
  label: "Searching knowledge",
  status: "done",
  ...over,
});

describe("prepareTraceForStorage", () => {
  it("stores nothing for a turn that did no agentic work", () => {
    // A verbatim custom_message or a proactive Notification: an empty trace row
    // would only make the Inbox render an empty panel.
    expect(prepareTraceForStorage(EMPTY_TURN_TRACE)).toBeNull();
  });

  it("keeps the steps and the search counter, unflagged when nothing was clipped", () => {
    const stored = prepareTraceForStorage(
      traceOf([tool(), { id: "t1", kind: "thought", label: "hmm", status: "done" }], 2)
    );
    expect(stored?.steps).toHaveLength(2);
    expect(stored?.searchCount).toBe(2);
    expect(stored?.truncated).toBe(false);
  });

  it("caps the step count and flags the trace, keeping the earliest steps", () => {
    const many = Array.from({ length: TRACE_MAX_STEPS + 10 }, (_, i) =>
      tool({ id: `call-${i}`, label: `step ${i}` })
    );
    const stored = prepareTraceForStorage(traceOf(many));
    expect(stored?.steps).toHaveLength(TRACE_MAX_STEPS);
    expect(stored?.steps[0].label).toBe("step 0");
    expect(stored?.truncated).toBe(true);
  });

  it("clips an unbounded thought and flags the trace", () => {
    const stored = prepareTraceForStorage(
      traceOf([{ id: "t1", kind: "thought", label: "x".repeat(50_000), status: "done" }])
    );
    expect(stored?.steps[0].label.length).toBeLessThan(50_000);
    expect(stored?.steps[0].label.endsWith("…")).toBe(true);
    expect(stored?.truncated).toBe(true);
  });

  it("redacts credentials a tool echoed into its outcome or input", () => {
    const stored = prepareTraceForStorage(
      traceOf([
        tool({
          detail: "upstream said Bearer sk-live-abcdef123456",
          input: { authorization: "sk-live-abcdef123456", query: "hours" },
        }),
      ])
    );
    expect(stored?.steps[0].detail).toContain("[redacted]");
    expect(stored?.steps[0].detail).not.toContain("sk-live-abcdef123456");
    expect(JSON.stringify(stored?.steps[0].input)).not.toContain(
      "sk-live-abcdef123456"
    );
    // The model-supplied arguments an operator actually needs survive.
    expect(stored?.steps[0].input).toMatchObject({ query: "hours" });
  });

  it("clips an oversized tool input to a preview instead of dropping the step", () => {
    const stored = prepareTraceForStorage(
      traceOf([tool({ input: { blob: "y".repeat(10_000) } })])
    );
    expect(stored?.steps[0].input).toHaveProperty("preview");
    expect(stored?.truncated).toBe(true);
  });

  it("stores a structured result at a bigger cap than the summary", () => {
    // A result worth showing as labelled rows is a response body; the 2k summary
    // cap would clip every one of them into uselessness.
    const body = "z".repeat(6_000);
    const stored = prepareTraceForStorage(
      traceOf([
        tool({
          tool: "queryEndpoint",
          result: { endpoint: "/api/courses/1818", status: "200 OK", response: body },
        }),
      ])
    );
    expect(stored?.steps[0].result).toMatchObject({
      endpoint: "/api/courses/1818",
      status: "200 OK",
    });
    expect(stored?.truncated).toBe(false);
  });

  it("clips an oversized result to a preview and flags the trace", () => {
    const stored = prepareTraceForStorage(
      traceOf([tool({ result: { response: "z".repeat(20_000) } })])
    );
    expect(stored?.steps[0].result).toHaveProperty("preview");
    expect(stored?.steps[0].result?.note).toContain("result clipped");
    expect(stored?.truncated).toBe(true);
  });

  it("redacts credentials echoed into a structured result", () => {
    // Response bodies carry more personal data and more secrets than any other
    // field on a trace.
    const stored = prepareTraceForStorage(
      traceOf([
        tool({
          result: { response: '{"authorization":"sk-live-abcdef123456"}' },
        }),
      ])
    );
    expect(JSON.stringify(stored?.steps[0].result)).not.toContain(
      "sk-live-abcdef123456"
    );
  });

  it("survives an input that cannot be serialized", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const stored = prepareTraceForStorage(traceOf([tool({ input: cyclic })]));
    expect(stored?.steps).toHaveLength(1);
    expect(stored?.steps[0].input).toMatchObject({
      note: "input could not be stored",
    });
  });

  it("settles a call whose end never arrived as an error, not a spinner", () => {
    // An aborted or crashed turn leaves the tool-start unpaired; stored as
    // "running" the Inbox panel would pulse forever.
    const trace = foldTraceEvent(EMPTY_TURN_TRACE, {
      type: "tool-start",
      callId: "call-9",
      tool: "fetchUrl",
      label: "Fetching https://example.com",
    });
    const stored = prepareTraceForStorage(trace);
    expect(stored?.steps[0].status).toBe("error");
  });

  it("stores what the shared fold produced from a real event sequence", () => {
    // The point of the shared fold: what the Inbox reads back is what the
    // visitor watched happen, not a second reconstruction of it.
    let trace = EMPTY_TURN_TRACE;
    for (const event of [
      {
        type: "notice",
        label: "Classifying intent",
        detail: "Matched flow “Default behavior”",
      },
      { type: "flow", flowId: "f1", flowName: "Default behavior", isDefault: true },
      { type: "thought", text: "They mean the 2025 intake." },
      {
        type: "tool-start",
        callId: "call-1",
        tool: "searchKnowledge",
        label: "Searching knowledge",
        input: { query: "intake" },
      },
      {
        type: "tool-end",
        callId: "call-1",
        tool: "searchKnowledge",
        ok: true,
        summary: "3 concepts found",
        durationMs: 210,
      },
    ] as const) {
      trace = foldTraceEvent(trace, event);
    }
    const stored = prepareTraceForStorage(trace);
    expect(stored?.searchCount).toBe(1);
    expect(stored?.steps.map((s) => s.kind)).toEqual(["notice", "thought", "tool"]);
    expect(stored?.steps[0].detail).toBe("Matched flow “Default behavior”");
    expect(stored?.steps[2]).toMatchObject({
      status: "done",
      detail: "3 concepts found",
      durationMs: 210,
    });
  });
});
