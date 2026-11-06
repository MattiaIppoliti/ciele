import { describe, expect, it } from "vitest";
import { IMPROVEMENT_STATUS_VALUES } from "./types";
import { IMPROVEMENT_WORKFLOW, isOpenImprovement } from "./improvements";

describe("answer improvement workflow", () => {
  it("takes an answer gap through a fix and validation before resolution", () => {
    expect(IMPROVEMENT_WORKFLOW.to_do.next).toBe("in_progress");
    expect(IMPROVEMENT_WORKFLOW.in_progress.next).toBe("in_review");
    expect(IMPROVEMENT_WORKFLOW.in_review.next).toBe("done");
    for (const status of IMPROVEMENT_STATUS_VALUES) {
      expect(IMPROVEMENT_WORKFLOW[status].next === null).toBe(!isOpenImprovement({ status }));
    }
  });
});
