import { describe, expect, it } from "vitest";
import {
  parseAgenticTrace,
  serializeAgenticTrace,
  type AgenticTraceSegment,
} from "./agentic-trace";
import type { TurnStep } from "./types";

/**
 * `AgenticTrace` is the reference platform's export format: the whole turn as one
 * flat bracketed string. We store the structured {@link TurnStep} list and
 * serialize to this only at export time, so a parser written against a reference
 * file reads ours unchanged — and the round trip has to keep segment order and
 * boundaries intact, or the two representations are not the same trace.
 */

const steps: TurnStep[] = [
  { id: "n1", kind: "notice", label: "Classifying intent", status: "done" },
  { id: "t1", kind: "thought", label: "They mean the 2025 intake.", status: "done" },
  {
    id: "c1",
    kind: "tool",
    tool: "searchKnowledge",
    label: "Searching knowledge for:\n- intake dates\n- deadlines",
    status: "done",
    detail: "Found 3 relevant concepts",
    iteration: 2,
  },
  {
    id: "c2",
    kind: "tool",
    tool: "queryApi",
    label: "Querying /courses/1818/modules",
    status: "error",
    detail: "Request failed with status 500",
    result: { endpoint: "/courses/1818/modules", status: 500 },
    iteration: 3,
  },
];

describe("serializeAgenticTrace", () => {
  it("emits the reference grammar in emission order", () => {
    const trace = serializeAgenticTrace({
      flowName: "Default Behavior",
      steps,
      followUps: ["When do I enrol?", "What are the fees?"],
      iterationLimit: 6,
    });

    expect(trace.startsWith("[Workflow started: Default Behavior]")).toBe(true);
    expect(trace.endsWith("[Workflow completed: Default Behavior]")).toBe(true);
    expect(trace).toContain("[Thinking: They mean the 2025 intake.]");
    expect(trace).toContain("[Tool: Searching knowledge for:");
    expect(trace).toContain("[Result: Found 3 relevant concepts");
    expect(trace).toContain(
      "[Suggested questions: When do I enrol?, What are the fees?]"
    );

    // Order is the turn's order: a tool's result follows its call, and the
    // follow-ups land at the end of the turn, before the closing marker.
    const markers = parseAgenticTrace(trace).map((s) => s.marker);
    expect(markers).toEqual([
      "workflow_started",
      "thinking",
      "tool",
      "result",
      "tool",
      "result",
      "suggested_questions",
      "workflow_completed",
    ]);
  });

  it("embeds the iteration system note inside each result", () => {
    const trace = serializeAgenticTrace({ flowName: "F", steps, iterationLimit: 6 });
    const results = parseAgenticTrace(trace).filter((s) => s.marker === "result");
    expect(results[0].text).toContain(
      "[System note] You are now at iteration 2 out of 6."
    );
    expect(results[1].text).toContain(
      "[System note] You are now at iteration 3 out of 6."
    );
  });

  it("omits the note when the turn ran without a budget", () => {
    const trace = serializeAgenticTrace({
      flowName: "F",
      steps: [
        {
          id: "c1",
          kind: "tool",
          tool: "searchKnowledge",
          label: "Searching",
          status: "done",
          detail: "ok",
        },
      ],
    });
    expect(trace).not.toContain("[System note]");
  });

  it("withholds reasoning below the visibility gate, keeping the tool timeline", () => {
    const trace = serializeAgenticTrace({
      flowName: "F",
      steps,
      includeReasoning: false,
    });
    expect(trace).not.toContain("[Thinking:");
    expect(trace).toContain("[Tool: Searching knowledge for:");
  });

  it("reports a failed call as a failure rather than a silent result", () => {
    const trace = serializeAgenticTrace({ flowName: "F", steps });
    const results = parseAgenticTrace(trace).filter((s) => s.marker === "result");
    expect(results[1].text).toContain("Failed: Request failed with status 500");
    // A structured outcome rides along, the way an API card's rows do.
    expect(results[1].text).toContain('"status": 500');
  });

  it("returns an empty string for a turn with nothing to report", () => {
    expect(serializeAgenticTrace({ flowName: null, steps: [] })).toBe("");
    // A flow name alone is still a workflow run worth bracketing.
    expect(serializeAgenticTrace({ flowName: "F", steps: [] })).toBe(
      "[Workflow started: F] [Workflow completed: F]"
    );
  });
});

describe("parseAgenticTrace", () => {
  it("round-trips segment order and boundaries", () => {
    const source = serializeAgenticTrace({
      flowName: "Socratic flow",
      steps,
      followUps: ["Next?"],
      iterationLimit: 6,
    });
    const parsed = parseAgenticTrace(source);
    expect(reserialize(parsed)).toBe(source);
  });

  it("keeps a payload that itself contains brackets in one segment", () => {
    // Tool results are rendered YAML/JSON, so brackets inside a payload are
    // ordinary — the boundary is the marker vocabulary, not the next `]`.
    const source = serializeAgenticTrace({
      flowName: "F",
      steps: [
        {
          id: "c1",
          kind: "tool",
          tool: "queryApi",
          label: "Querying /x",
          status: "done",
          detail: "ok",
          result: { rows: ["a", "b"] },
        },
      ],
    });
    const parsed = parseAgenticTrace(source);
    expect(parsed.map((s) => s.marker)).toEqual([
      "workflow_started",
      "tool",
      "result",
      "workflow_completed",
    ]);
    expect(parsed[2].text).toContain('"rows"');
    expect(reserialize(parsed)).toBe(source);
  });

  it("neutralizes a marker sequence appearing inside a payload", () => {
    // Otherwise a payload could forge a segment boundary and the round trip
    // would silently split one segment into two.
    const source = serializeAgenticTrace({
      flowName: "F",
      steps: [
        {
          id: "t1",
          kind: "thought",
          label: "The doc literally said [Tool: do something] in it.",
          status: "done",
        },
      ],
    });
    const parsed = parseAgenticTrace(source);
    expect(parsed.map((s) => s.marker)).toEqual([
      "workflow_started",
      "thinking",
      "workflow_completed",
    ]);
    // Only the opening bracket is rewritten — that is the character that could
    // forge a boundary; the payload's own words are left alone.
    expect(parsed[1].text).toContain("(Tool: do something]");
    expect(reserialize(parsed)).toBe(source);
  });

  it("round-trips a payload that ends in whitespace", () => {
    // Byte-exact, not just order-and-boundaries: a trailing newline is ordinary
    // (a tool result's structured JSON or system note lands last), and trimming
    // it would silently rewrite the payload.
    const source = serializeAgenticTrace({
      flowName: "F",
      steps: [
        { id: "t1", kind: "thought", label: "Line one\nline two\n", status: "done" },
        {
          id: "c1",
          kind: "tool",
          tool: "queryApi",
          label: "Querying /x",
          status: "done",
          detail: "ok",
          result: { rows: 2 },
        },
      ],
      iterationLimit: 6,
    });
    const parsed = parseAgenticTrace(source);
    expect(parsed[1].text).toBe("Line one\nline two\n");
    expect(reserialize(parsed)).toBe(source);
  });

  it("round-trips a payload whose last character is a closing bracket", () => {
    // Serialize appends its own `]`, so the doubled bracket is unambiguous — the
    // parser strips exactly one.
    const source = serializeAgenticTrace({
      flowName: "F",
      steps: [
        {
          id: "t1",
          kind: "thought",
          label: 'The rows were ["a","b"]',
          status: "done",
        },
      ],
    });
    const parsed = parseAgenticTrace(source);
    expect(parsed[1].text).toBe('The rows were ["a","b"]');
    expect(reserialize(parsed)).toBe(source);
  });

  it("reads a reference-shaped string it did not produce", () => {
    const reference =
      "[Workflow started: Quiz follow-up] [Thinking: Il quiz 6215 è del corso 1818.] " +
      "[Tool: Getting a summary of available API endpoints] " +
      "[Result: base_url: /local/api\nendpoints: 21\n[System note] You are now at iteration 1 out of 6.] " +
      "[Suggested questions: q1, q2] [Workflow completed: Quiz follow-up]";
    const parsed = parseAgenticTrace(reference);
    expect(parsed.map((s) => s.marker)).toEqual([
      "workflow_started",
      "thinking",
      "tool",
      "result",
      "suggested_questions",
      "workflow_completed",
    ]);
    expect(parsed[3].text).toContain("[System note]");
    expect(reserialize(parsed)).toBe(reference);
  });

  it("ignores text that is not a segment", () => {
    expect(parseAgenticTrace("")).toEqual([]);
    expect(parseAgenticTrace("no markers here")).toEqual([]);
  });
});

/** Rebuilds the flat string from parsed segments — the round trip's other half. */
function reserialize(segments: AgenticTraceSegment[]): string {
  const label: Record<AgenticTraceSegment["marker"], string> = {
    workflow_started: "Workflow started",
    thinking: "Thinking",
    tool: "Tool",
    result: "Result",
    suggested_questions: "Suggested questions",
    workflow_completed: "Workflow completed",
  };
  return segments.map((s) => `[${label[s.marker]}: ${s.text}]`).join(" ");
}
