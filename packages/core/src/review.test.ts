import { describe, expect, it } from "vitest";
import type { ReviewRequest } from "./types";
import {
  DEFAULT_REVIEW_EXPIRED_MESSAGE,
  DEFAULT_REVIEW_HALT_MESSAGE,
  canDecideReview,
  decideReview,
  expireReview,
  humanReviewSettingsIssue,
  isReviewOverdue,
  normalizeAssignees,
  reviewExpiresAt,
  reviewHaltMessage,
  reviewTemplateVariables,
  reviewTimeoutHours,
} from "./review";

const now = new Date("2026-09-08T12:00:00Z");

const review = (over: Partial<ReviewRequest> = {}): ReviewRequest => ({
  id: "rev_1",
  organizationId: "org",
  assistantId: "a1",
  conversationId: "c1",
  flowId: "f1",
  actionIndex: 1,
  status: "pending",
  title: "Approve refund",
  message: "A student asks for a refund.",
  summary: "Student: refund please",
  channel: "email",
  assignees: ["ann@campus.edu"],
  inputs: [
    { id: "amount", label: "Amount", type: "short_text", required: true },
    { id: "reason", label: "Reason", type: "dropdown", options: ["Policy", "Goodwill"] },
  ],
  decision: null,
  decidedBy: null,
  decidedByName: null,
  decidedAt: null,
  expiresAt: "2026-09-09T12:00:00Z",
  haltMessage: "",
  simulated: false,
  resumedAt: null,
  createdAt: "2026-09-08T12:00:00Z",
  updatedAt: "2026-09-08T12:00:00Z",
  ...over,
});

const ann = { userId: "u-ann", email: "Ann@Campus.edu", displayName: "Ann", role: "editor" as const };
const bob = { userId: "u-bob", email: "bob@campus.edu", displayName: "Bob", role: "editor" as const };
const admin = { userId: "u-adm", email: "adm@campus.edu", displayName: null, role: "admin" as const };

describe("the clock", () => {
  it("clamps the timeout and derives the expiry from it", () => {
    expect(reviewTimeoutHours({})).toBe(24);
    expect(reviewTimeoutHours({ timeoutHours: 0 })).toBe(1);
    expect(reviewTimeoutHours({ timeoutHours: 10_000 })).toBe(24 * 14);
    expect(reviewExpiresAt(now, 2)).toBe("2026-09-08T14:00:00.000Z");
  });

  it("is overdue only while pending", () => {
    expect(isReviewOverdue(review(), new Date("2026-09-09T12:00:00Z"))).toBe(true);
    expect(isReviewOverdue(review(), now)).toBe(false);
    expect(isReviewOverdue(review({ status: "approved" }), new Date("2026-10-01"))).toBe(false);
  });
});

describe("who may decide", () => {
  it("an assignee by email, case-insensitively, and any Owner or Admin", () => {
    expect(canDecideReview(review(), ann)).toBe(true);
    expect(canDecideReview(review(), bob)).toBe(false);
    expect(canDecideReview(review(), admin)).toBe(true);
  });

  it("normalizes assignee lists: trimmed, lower-cased, deduplicated, invalid dropped", () => {
    expect(normalizeAssignees([" Ann@Campus.edu", "ann@campus.edu", "nope", ""])).toEqual([
      "ann@campus.edu",
    ]);
  });
});

describe("decideReview", () => {
  it("first decision wins and records who and when", () => {
    const result = decideReview(review(), {
      decision: "approved",
      inputs: { amount: " 50 ", reason: "Policy" },
      decider: ann,
      now,
    });
    expect(result).toMatchObject({
      ok: true,
      review: {
        status: "approved",
        decision: { amount: "50", reason: "Policy" },
        decidedBy: "u-ann",
        decidedByName: "Ann",
        decidedAt: now.toISOString(),
      },
    });
  });

  it("a second decision is refused and names the first decider", () => {
    const first = decideReview(review(), { decision: "rejected", inputs: {}, decider: ann, now });
    expect(first.ok).toBe(true);
    const second = decideReview((first as { ok: true; review: ReviewRequest }).review, {
      decision: "approved",
      inputs: { amount: "1" },
      decider: admin,
      now,
    });
    expect(second).toEqual({ ok: false, reason: "already_decided", decidedByName: "Ann" });
  });

  it("refuses a non-assignee, an overdue request and a missing required input", () => {
    expect(decideReview(review(), { decision: "approved", inputs: { amount: "1" }, decider: bob, now })).toEqual({
      ok: false,
      reason: "not_assignee",
    });
    expect(
      decideReview(review(), {
        decision: "approved",
        inputs: { amount: "1" },
        decider: ann,
        now: new Date("2026-09-10T00:00:00Z"),
      })
    ).toEqual({ ok: false, reason: "expired" });
    expect(decideReview(review(), { decision: "approved", inputs: {}, decider: ann, now })).toEqual({
      ok: false,
      reason: "missing_input",
      fieldId: "amount",
    });
    expect(
      decideReview(review(), {
        decision: "approved",
        inputs: { amount: "1", reason: "Not an option" },
        decider: ann,
        now,
      })
    ).toEqual({ ok: false, reason: "missing_input", fieldId: "reason" });
  });

  it("a simulated request approves without its required inputs", () => {
    expect(
      decideReview(review({ simulated: true }), { decision: "approved", inputs: {}, decider: ann, now })
    ).toMatchObject({ ok: true, review: { status: "approved", decision: {} } });
  });

  it("a rejection needs no inputs", () => {
    expect(decideReview(review(), { decision: "rejected", inputs: {}, decider: ann, now })).toMatchObject({
      ok: true,
      review: { status: "rejected", decision: {} },
    });
  });

  it("an admin's decision uses their email as the name when they have none", () => {
    const result = decideReview(review(), { decision: "rejected", inputs: {}, decider: admin, now });
    expect((result as { ok: true; review: ReviewRequest }).review.decidedByName).toBe("adm@campus.edu");
  });
});

describe("expireReview", () => {
  it("flips only a pending, overdue request", () => {
    expect(expireReview(review(), now)).toBeNull();
    expect(expireReview(review(), new Date("2026-09-09T12:00:01Z"))).toMatchObject({ status: "expired" });
    expect(expireReview(review({ status: "approved" }), new Date("2026-10-01"))).toBeNull();
  });
});

describe("what the Flow sees afterwards", () => {
  it("exposes every input under review.* plus the decision facts", () => {
    const approved = review({
      status: "approved",
      decision: { amount: "50" },
      decidedByName: "Ann",
      decidedAt: "2026-09-08T13:00:00Z",
    });
    expect(reviewTemplateVariables(approved)).toEqual({
      "review.status": "approved",
      "review.approved": "true",
      "review.decidedBy": "Ann",
      "review.decidedAt": "2026-09-08T13:00:00Z",
      "review.title": "Approve refund",
      "review.amount": "50",
      "review.reason": "",
    });
  });

  it("halts with the configured message, or a default that says which way it closed", () => {
    expect(reviewHaltMessage(review({ status: "rejected", haltMessage: " No. " }))).toBe("No.");
    expect(reviewHaltMessage(review({ status: "rejected" }))).toBe(DEFAULT_REVIEW_HALT_MESSAGE);
    expect(reviewHaltMessage(review({ status: "expired" }))).toBe(DEFAULT_REVIEW_EXPIRED_MESSAGE);
  });
});

describe("humanReviewSettingsIssue", () => {
  const ok = {
    title: "Approve refund",
    assignees: ["ann@campus.edu"],
    channel: "email" as const,
    senderConnectionId: "conn_1",
    inputs: [{ id: "amount", label: "Amount", type: "short_text" as const }],
  };

  it("accepts a complete configuration", () => {
    expect(humanReviewSettingsIssue(ok)).toBeNull();
    expect(humanReviewSettingsIssue({ ...ok, channel: "slack", slackTarget: "C123" })).toBeNull();
  });

  it("names the first missing piece", () => {
    expect(humanReviewSettingsIssue(undefined)).toMatch(/not configured/);
    expect(humanReviewSettingsIssue({ ...ok, title: " " })).toMatch(/title/);
    expect(humanReviewSettingsIssue({ ...ok, assignees: ["nope"] })).toMatch(/Assign/);
    expect(humanReviewSettingsIssue({ ...ok, senderConnectionId: undefined })).toMatch(/mailbox/);
    expect(humanReviewSettingsIssue({ ...ok, channel: "slack" })).toMatch(/Slack/);
    expect(humanReviewSettingsIssue({ ...ok, inputs: [] })).toMatch(/at least one input/);
    expect(
      humanReviewSettingsIssue({ ...ok, inputs: [{ id: "a", label: "", type: "short_text" }] })
    ).toMatch(/label/);
    expect(
      humanReviewSettingsIssue({
        ...ok,
        inputs: [
          { id: "a", label: "A", type: "short_text" },
          { id: "a", label: "B", type: "short_text" },
        ],
      })
    ).toMatch(/twice/);
    expect(
      humanReviewSettingsIssue({ ...ok, inputs: [{ id: "1bad", label: "A", type: "short_text" }] })
    ).toMatch(/identifier/);
    expect(
      humanReviewSettingsIssue({ ...ok, inputs: [{ id: "r", label: "R", type: "dropdown", options: [] }] })
    ).toMatch(/option/);
  });
});
