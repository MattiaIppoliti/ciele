import { describe, expect, it } from "vitest";
import type { StoredTurnTrace, TurnStep } from "@agent-hub/core";
import { liveTraceLabel, storedTraceLabel, visibleTraceSteps } from "./stored-trace";

const trace: StoredTurnTrace = {
  searchCount: 2,
  truncated: true,
  steps: [
    // A legacy `kind: "step"` row: traces persisted before the phase machine was
    // retired (#560) still hold them, and must still render.
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
          { id: "s1", kind: "notice", label: "Classifying intent", status: "done" },
        ],
      },
      { canViewReasoning: true }
    )!;
    expect(storedTraceLabel(visible)).toBe("Thought");
  });
});

describe("liveTraceLabel", () => {
  it("names the running tool", () => {
    expect(liveTraceLabel(trace.steps)).toBe("Searching knowledge…");
  });

  it("never puts reasoning or an operator diagnostic in the header", () => {
    // A thought's label is raw model reasoning and a notice's is addressed to an
    // admin; neither belongs in a collapsed header a Visitor is watching. Both
    // still appear as rows in the expanded panel.
    expect(
      liveTraceLabel([
        { id: "n1", kind: "notice", label: "Classifying intent", status: "done" },
        {
          id: "n2",
          kind: "notice",
          label:
            "No AI provider credential configured for this organization — add one in Settings → AI",
          status: "done",
        },
        { id: "t1", kind: "thought", label: "The visitor probably means…", status: "done" },
      ])
    ).toBe("Thinking…");
  });

  it("keeps naming the tool when reasoning follows it", () => {
    // The model narrates after a call returns; the header should still say what
    // ran, not quote the narration.
    expect(
      liveTraceLabel([
        {
          id: "c1",
          kind: "tool",
          tool: "searchKnowledge",
          label: "Searching knowledge",
          status: "done",
        },
        { id: "t1", kind: "thought", label: "Nothing useful — try again.", status: "done" },
      ])
    ).toBe("Searching knowledge…");
  });

  it("keeps only the first line of a multi-line tool label", () => {
    // A batched knowledge search lists its queries; the header is one line, and
    // the expanded timeline carries the rest.
    expect(
      liveTraceLabel([
        {
          id: "c1",
          kind: "tool",
          tool: "searchKnowledge",
          label: "Searching knowledge for:\n- fees\n- deadlines",
          status: "running",
        },
      ])
    ).toBe("Searching knowledge for:");
  });

  it("clips a long label and keeps existing terminal punctuation", () => {
    const tool = (label: string): TurnStep => ({
      id: "c1",
      kind: "tool",
      tool: "searchKnowledge",
      label,
      status: "running",
    });
    const long = liveTraceLabel([tool("a".repeat(200))]);
    expect(long.length).toBeLessThanOrEqual(66);
    expect(long.endsWith("…")).toBe(true);
    expect(liveTraceLabel([tool("Already ends in an ellipsis…")])).toBe(
      "Already ends in an ellipsis…"
    );
  });

  it("falls back to Thinking… before the first tool call", () => {
    expect(liveTraceLabel([])).toBe("Thinking…");
    expect(
      liveTraceLabel([
        {
          id: "c1",
          kind: "tool",
          tool: "searchKnowledge",
          label: "   ",
          status: "running",
        },
      ])
    ).toBe("Thinking…");
  });
});
