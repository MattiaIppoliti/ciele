import { describe, expect, it } from "vitest";
import {
  completeFollowUp,
  initialFollowUpState,
  submitFollowUp,
} from "./follow-up-scheduler";

describe("follow-up scheduler", () => {
  it("queues every follow-up and starts them in order after the active turn", () => {
    const first = submitFollowUp(initialFollowUpState(), "first", "queue");
    expect(first.commands).toEqual([{ type: "start", message: "first" }]);

    const second = submitFollowUp(first.state, "second", "queue");
    const third = submitFollowUp(second.state, "third", "queue");
    expect(third.state.queued).toEqual(["second", "third"]);
    expect(third.commands).toEqual([]);

    const afterFirst = completeFollowUp(third.state);
    expect(afterFirst.commands).toEqual([{ type: "start", message: "second" }]);
    const afterSecond = completeFollowUp(afterFirst.state);
    expect(afterSecond.commands).toEqual([{ type: "start", message: "third" }]);
    expect(completeFollowUp(afterSecond.state)).toEqual({
      state: { active: false, queued: [] },
      commands: [],
    });
  });

  it("steers by aborting the active turn and keeping only the newest message", () => {
    const first = submitFollowUp(initialFollowUpState(), "first", "steer");
    const second = submitFollowUp(first.state, "second", "steer");
    expect(second).toEqual({
      state: { active: true, queued: ["second"] },
      commands: [{ type: "abort" }],
    });

    const third = submitFollowUp(second.state, "third", "steer");
    expect(third.state.queued).toEqual(["third"]);
    expect(third.commands).toEqual([{ type: "abort" }]);
    expect(completeFollowUp(third.state).commands).toEqual([
      { type: "start", message: "third" },
    ]);
  });
});
