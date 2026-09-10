import { describe, expect, it } from "vitest";
import type { ReviewStatus } from "@agent-hub/core";
import { reviewDecisionLabel, reviewStatusLabel, reviewStatusSentence } from "./review-status";

/**
 * The strings five surfaces show for a Human review's status (#841). Pinned
 * verbatim: the extraction that put them here had to keep every one identical,
 * and a rewording is a product decision, not a refactor.
 */

const STATUSES: ReviewStatus[] = ["pending", "approved", "rejected", "expired"];

describe("reviewStatusLabel", () => {
  it("is the capitalised status word, one per status", () => {
    expect(STATUSES.map(reviewStatusLabel)).toEqual([
      "Pending",
      "Approved",
      "Rejected",
      "Expired",
    ]);
  });
});

describe("reviewDecisionLabel", () => {
  it("names the decider when there is one", () => {
    expect(reviewDecisionLabel({ status: "approved", decidedByName: "Dana" })).toBe(
      "Approved by Dana"
    );
    expect(reviewDecisionLabel({ status: "rejected", decidedByName: "Dana" })).toBe(
      "Rejected by Dana"
    );
  });

  it("is the bare label when nobody decided", () => {
    expect(reviewDecisionLabel({ status: "pending" })).toBe("Pending");
    expect(reviewDecisionLabel({ status: "expired", decidedByName: null })).toBe("Expired");
    expect(reviewDecisionLabel({ status: "approved", decidedByName: "" })).toBe("Approved");
  });
});

describe("reviewStatusSentence", () => {
  it("tells a Visitor what happened, in the widget's own words", () => {
    expect(STATUSES.map(reviewStatusSentence)).toEqual([
      "Waiting for a colleague to review this.",
      "Reviewed and approved.",
      "Reviewed and not approved.",
      "The review request expired.",
    ]);
  });
});
