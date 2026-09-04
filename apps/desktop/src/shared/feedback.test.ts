import { describe, expect, it } from "vitest";
import { stackCue, stepCues } from "./feedback";

describe("stepCues", () => {
  it("is silent on the first snapshot, which is not a change", () => {
    expect(stepCues(null, ["done", "failed"])).toEqual([]);
  });

  it("sounds a step that just passed or just failed", () => {
    expect(stepCues(["running", "pending"], ["done", "pending"])).toEqual(["success"]);
    expect(stepCues(["running", "pending"], ["failed", "pending"])).toEqual(["error"]);
  });

  it("stays silent while a step is merely moving", () => {
    expect(stepCues(["pending", "pending"], ["running", "pending"])).toEqual([]);
    expect(stepCues(["done"], ["done"])).toEqual([]);
    expect(stepCues(["pending"], ["skipped"])).toEqual([]);
  });

  it("reports every step that settled in one snapshot, in order", () => {
    expect(stepCues(["running", "running"], ["done", "failed"])).toEqual(["success", "error"]);
  });
});

describe("stackCue", () => {
  it("chimes when the stack comes up", () => {
    expect(stackCue("starting", "running")).toBe("arrive");
    expect(stackCue("stopped", "running")).toBe("arrive");
  });

  it("is silent otherwise", () => {
    expect(stackCue(null, "running")).toBeNull();
    expect(stackCue("running", "running")).toBeNull();
    expect(stackCue("running", "stopped")).toBeNull();
    expect(stackCue("stopped", "starting")).toBeNull();
  });
});
