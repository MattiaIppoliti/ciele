import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_ITERATIONS,
  createLoopBudget,
  iterationNote,
  withBudgetNote,
} from "./loop-budget";

describe("iterationNote", () => {
  it("states where the turn is and that the terminal tool is mandatory", () => {
    const note = iterationNote(2, 6);
    expect(note).toContain("iteration 2 out of 6");
    expect(note).toContain("ReadyToAnswer");
  });

  it("escalates to finalize-now with one iteration left", () => {
    const note = iterationNote(5, 6);
    expect(note).toContain("1 iteration");
    expect(note).toContain("MUST call ReadyToAnswer now");
    // Not yet a prohibition — the model may still finish its thought.
    expect(note).not.toContain("Do not call any other tool");
  });

  it("forbids further tools and answer text on the final iteration", () => {
    const note = iterationNote(6, 6);
    expect(note).toContain("CRITICAL");
    expect(note).toContain("Do not call any other tool");
    expect(note).toContain("will not get another turn");
  });

  it("keeps the final-turn wording once the budget is overspent", () => {
    // Defensive: a tool that spends twice must not roll back into the friendly
    // note, which would read as "you have room" on a turn that has none.
    expect(iterationNote(9, 6)).toContain("CRITICAL");
  });
});

describe("createLoopBudget", () => {
  it("counts from one and reports the note for the iteration just spent", () => {
    const loop = createLoopBudget(3);
    expect(loop.iteration).toBe(0);
    expect(loop.spend()).toBe(1);
    expect(loop.note()).toContain("iteration 1 out of 3");
    // One charge per STEP, so the step has to close before the next one counts.
    loop.endStep();
    loop.spend();
    loop.endStep();
    loop.spend();
    expect(loop.iteration).toBe(3);
    expect(loop.note()).toContain("CRITICAL");
  });

  it("defaults to the shipped limit", () => {
    expect(createLoopBudget().limit).toBe(MAX_AGENT_ITERATIONS);
  });

  it("charges a step ONCE however many tools it calls in parallel", () => {
    // Load-bearing, not cosmetic: the API-catalogue pattern (#559) fetches
    // endpoint details in parallel on purpose, so charging per call would spend
    // the whole budget on discovery before anything was queried.
    const loop = createLoopBudget(6);
    expect(loop.spend()).toBe(1);
    expect(loop.spend()).toBe(1);
    expect(loop.spend()).toBe(1);
    expect(loop.iteration).toBe(1);
    expect(loop.note()).toContain("iteration 1 out of 6");

    loop.endStep();
    expect(loop.spend()).toBe(2);
    expect(loop.iteration).toBe(2);
  });

  it("does not charge a step that called no tools at all", () => {
    const loop = createLoopBudget(6);
    loop.endStep();
    loop.endStep();
    expect(loop.iteration).toBe(0);
  });
});

describe("withBudgetNote", () => {
  it("attaches the note to an object result without disturbing it", () => {
    const loop = createLoopBudget(6);
    loop.spend();
    const out = withBudgetNote({ results: [1, 2], note: "existing" }, loop) as
      Record<string, unknown>;
    expect(out.results).toEqual([1, 2]);
    expect(out.note).toBe("existing");
    expect(String(out.systemNote)).toContain("iteration 1 out of 6");
  });

  it("boxes a non-object result so the note is still readable", () => {
    const loop = createLoopBudget(6);
    loop.spend();
    const out = withBudgetNote("plain text", loop) as Record<string, unknown>;
    expect(out.result).toBe("plain text");
    expect(out.systemNote).toBeTypeOf("string");
  });

  it("changes nothing when the turn has no budget wired", () => {
    // The deterministic no-model path and pure tests: the note is guidance,
    // never load-bearing.
    const output = { results: [] };
    expect(withBudgetNote(output, undefined)).toBe(output);
  });
});
