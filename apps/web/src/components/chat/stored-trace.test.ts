import { describe, expect, it } from "vitest";
import type { StoredTurnTrace } from "@agent-hub/core";
import { storedTraceLabel, visibleTraceSteps } from "./stored-trace";

const trace: StoredTurnTrace = {
  searchCount: 2,
  truncated: true,
  steps: [
    { id: "s1", kind: "step", label: "Classifying intent", stage: "classify", status: "done" },
    { id: "t1", kind: "thought", label: "The visitor means the 2025 intake.", status: "done" },
    {
      id: "c1",
      kind: "tool",
      tool: "searchKnowledge",
      label: "Searching knowledge",
      status: "done",
      input: { query: "intake dates" },
    },
    { id: "t2", kind: "thought", label: "Nothing on fees — search again.", status: "done" },
    {
      id: "c2",
      kind: "tool",
      tool: "searchKnowledge",
      label: "Searching knowledge",
      status: "done",
    },
  ],
};

describe("visibleTraceSteps", () => {
  it("keeps everything for a Member who may read reasoning", () => {
    const visible = visibleTraceSteps(trace, { canViewReasoning: true });
    expect(visible?.steps).toHaveLength(5);
    expect(visible?.hiddenThoughts).toBe(0);
    expect(visible?.searchCount).toBe(2);
    expect(visible?.truncated).toBe(true);
  });

  it("drops reasoning but keeps the tool timeline below the gate", () => {
    const visible = visibleTraceSteps(trace, { canViewReasoning: false });
    expect(visible?.steps.map((s) => s.id)).toEqual(["s1", "c1", "c2"]);
    expect(visible?.hiddenThoughts).toBe(2);
    // The counters describe the turn that ran, not the filtered view of it.
    expect(visible?.searchCount).toBe(2);
  });

  it("renders no panel for a turn that did no agentic work", () => {
    expect(visibleTraceSteps(null, { canViewReasoning: true })).toBeNull();
    expect(
      visibleTraceSteps({ steps: [], searchCount: 0 }, { canViewReasoning: true })
    ).toBeNull();
  });

  it("treats a missing truncated flag as not truncated", () => {
    const visible = visibleTraceSteps(
      { steps: trace.steps, searchCount: 1 },
      { canViewReasoning: true }
    );
    expect(visible?.truncated).toBe(false);
  });
});

describe("storedTraceLabel", () => {
  it("reports the work the turn did instead of a clock it does not have", () => {
    const visible = visibleTraceSteps(trace, { canViewReasoning: true })!;
    expect(storedTraceLabel(visible)).toBe("Thought · 2 tool calls, 2 thoughts");
  });

  it("singularizes and omits what is absent", () => {
    const visible = visibleTraceSteps(
      {
        searchCount: 1,
        steps: [
          {
            id: "c1",
            kind: "tool",
            tool: "searchKnowledge",
            label: "Searching knowledge",
            status: "done",
          },
        ],
      },
      { canViewReasoning: true }
    )!;
    expect(storedTraceLabel(visible)).toBe("Thought · 1 tool call");
  });

  it("falls back to a bare label when only engine steps survive", () => {
    const visible = visibleTraceSteps(
      {
        searchCount: 0,
        steps: [
          { id: "s1", kind: "step", label: "Classifying intent", status: "done" },
        ],
      },
      { canViewReasoning: true }
    )!;
    expect(storedTraceLabel(visible)).toBe("Thought");
  });
});
