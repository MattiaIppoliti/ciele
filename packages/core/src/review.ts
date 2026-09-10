import type {
  HumanReviewSettings,
  ReviewDecision,
  ReviewInputField,
  ReviewRequest,
  Role,
} from "./types";

/**
 * The Human review gate's state machine (spec #836, #841), as pure functions
 * over the `ReviewRequest` row.
 *
 * pending → approved | rejected (the first Member's decision) | expired (the
 * clock). Every transition is decided here and enforced in the operations
 * layer, so the console page, the versioned API, the CLI, the MCP tool and the
 * expiry sweep cannot disagree about who may close a request or when.
 */

export const DEFAULT_REVIEW_TIMEOUT_HOURS = 24;
/** The delegated Graph scope the sender mailbox must hold. */
export const REVIEW_MAIL_SCOPE = "Mail.Send";
/** The Slack bot scope the Organization's connection must hold to post the request. */
export const REVIEW_SLACK_SCOPE = "chat:write";
export const MIN_REVIEW_TIMEOUT_HOURS = 1;
export const MAX_REVIEW_TIMEOUT_HOURS = 24 * 14;

export const DEFAULT_REVIEW_WAITING_MESSAGE =
  "I've asked a colleague to review this. I'll continue as soon as they answer.";
export const DEFAULT_REVIEW_HALT_MESSAGE =
  "This request was not approved, so I can't continue with it.";
export const DEFAULT_REVIEW_EXPIRED_MESSAGE =
  "Nobody was able to review this in time, so I can't continue with it.";

export function reviewTimeoutHours(settings: Pick<HumanReviewSettings, "timeoutHours">): number {
  const hours = settings.timeoutHours;
  if (typeof hours !== "number" || !Number.isFinite(hours)) return DEFAULT_REVIEW_TIMEOUT_HOURS;
  return Math.min(MAX_REVIEW_TIMEOUT_HOURS, Math.max(MIN_REVIEW_TIMEOUT_HOURS, hours));
}

export function reviewExpiresAt(createdAt: Date, timeoutHours: number): string {
  return new Date(createdAt.getTime() + timeoutHours * 3_600_000).toISOString();
}

/** Whether a pending request's clock has run out. */
export function isReviewOverdue(
  review: Pick<ReviewRequest, "status" | "expiresAt">,
  now: Date
): boolean {
  return review.status === "pending" && Date.parse(review.expiresAt) <= now.getTime();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAssignees(assignees: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  for (const raw of assignees ?? []) {
    const email = raw.trim().toLowerCase();
    if (email && EMAIL.test(email)) seen.add(email);
  }
  return [...seen];
}

/** The asking Member: email for the assignee check, Role for the admin override. */
export interface ReviewDecider {
  userId: string;
  email: string;
  displayName?: string | null;
  role: Role | null;
}

/**
 * Whether this Member may close the request: an assignee, or an Owner/Admin
 * (oversight has to be able to unblock a Visitor when the assignee is away).
 */
export function canDecideReview(
  review: Pick<ReviewRequest, "assignees">,
  decider: Pick<ReviewDecider, "email" | "role">
): boolean {
  if (decider.role === "owner" || decider.role === "admin") return true;
  return review.assignees.includes(decider.email.trim().toLowerCase());
}

export type ReviewRefusal =
  | { ok: false; reason: "already_decided"; decidedByName: string | null }
  | { ok: false; reason: "expired" }
  | { ok: false; reason: "not_assignee" }
  | { ok: false; reason: "missing_input"; fieldId: string };

export type ReviewTransition = { ok: true; review: ReviewRequest } | ReviewRefusal;

/**
 * The decision, first one wins. Returns the row as it should be stored, or
 * why it cannot be. Inputs are checked only on approval: a rejection needs no
 * amount, and asking for one would make "no" harder to say than "yes".
 */
export function decideReview(
  review: ReviewRequest,
  input: {
    decision: ReviewDecision;
    inputs: Record<string, string>;
    decider: ReviewDecider;
    now: Date;
  }
): ReviewTransition {
  if (review.status === "expired") return { ok: false, reason: "expired" };
  if (review.status !== "pending") {
    return { ok: false, reason: "already_decided", decidedByName: review.decidedByName };
  }
  if (isReviewOverdue(review, input.now)) return { ok: false, reason: "expired" };
  if (!canDecideReview(review, input.decider)) return { ok: false, reason: "not_assignee" };
  const decision: Record<string, string> = {};
  for (const field of review.inputs) {
    const value = (input.inputs[field.id] ?? "").trim();
    // A simulated request (Preview / Teammate chat) is decided from an inline
    // card with no form: it tests the chain, not the reviewer's typing.
    if (input.decision === "approved" && field.required && !value && !review.simulated) {
      return { ok: false, reason: "missing_input", fieldId: field.id };
    }
    if (field.type === "dropdown" && value && field.options && !field.options.includes(value)) {
      return { ok: false, reason: "missing_input", fieldId: field.id };
    }
    if (value) decision[field.id] = value;
  }
  return {
    ok: true,
    review: {
      ...review,
      status: input.decision,
      decision,
      decidedBy: input.decider.userId,
      decidedByName: input.decider.displayName?.trim() || input.decider.email,
      decidedAt: input.now.toISOString(),
      updatedAt: input.now.toISOString(),
    },
  };
}

/** The expiry sweep's transition: pending and overdue → expired, otherwise nothing. */
export function expireReview(review: ReviewRequest, now: Date): ReviewRequest | null {
  if (!isReviewOverdue(review, now)) return null;
  return { ...review, status: "expired", updatedAt: now.toISOString() };
}

/**
 * What the Flow's remaining actions may interpolate after approval (#841,
 * story 54): every Input under `review.<fieldId>`, plus who decided and when.
 */
export function reviewTemplateVariables(review: ReviewRequest): Record<string, string> {
  const vars: Record<string, string> = {
    "review.status": review.status,
    "review.approved": review.status === "approved" ? "true" : "false",
    "review.decidedBy": review.decidedByName ?? "",
    "review.decidedAt": review.decidedAt ?? "",
    "review.title": review.title,
  };
  for (const field of review.inputs) {
    vars[`review.${field.id}`] = review.decision?.[field.id] ?? "";
  }
  return vars;
}

/** What the Visitor reads when the gate closes without approval. */
export function reviewHaltMessage(review: Pick<ReviewRequest, "status" | "haltMessage">): string {
  if (review.haltMessage.trim()) return review.haltMessage.trim();
  return review.status === "expired" ? DEFAULT_REVIEW_EXPIRED_MESSAGE : DEFAULT_REVIEW_HALT_MESSAGE;
}

/**
 * The Needs-setup rule the canvas, the form and Publish share. `null` means
 * configured. Assignee *membership* is checked at Publish, where the roster
 * is; here only the shape.
 */
export function humanReviewSettingsIssue(
  settings: HumanReviewSettings | undefined
): string | null {
  if (!settings) return "Human review is not configured.";
  if (!settings.title?.trim()) return "Give the review a title.";
  if (normalizeAssignees(settings.assignees).length === 0) {
    return "Assign at least one colleague by email.";
  }
  const channel = settings.channel ?? "email";
  if (channel === "email" && !settings.senderConnectionId) {
    return "Connect the mailbox the request is sent from.";
  }
  if (channel === "slack" && !settings.slackTarget?.trim()) {
    return "Pick the Slack channel or person to notify.";
  }
  const inputs = settings.inputs ?? [];
  if (inputs.length === 0) return "Add at least one input for the reviewer to fill.";
  const blank = inputs.find((field) => !field.label.trim());
  if (blank) return "Every input needs a label.";
  const ids = new Set<string>();
  for (const field of inputs) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(field.id)) {
      return `Input id "${field.id}" must be a short identifier (letters, digits, underscores).`;
    }
    if (ids.has(field.id)) return `Input id "${field.id}" is used twice.`;
    ids.add(field.id);
    if (field.type === "dropdown" && !(field.options ?? []).some((o) => o.trim())) {
      return `Dropdown "${field.label}" needs at least one option.`;
    }
  }
  return null;
}

/**
 * The request as one text, for the email body and the Slack message alike, and
 * for the canvas's Run node preview, which shows the assignee's view with a
 * placeholder where the link goes. Pure, so the three cannot drift.
 */
export function reviewRequestText(input: {
  title: string;
  message: string;
  summary: string;
  assistantTitle: string;
  link: string;
  expiresAt?: string | null;
}): { subject: string; body: string } {
  const message = input.message.trim();
  const summary = input.summary.trim();
  const lines: (string | null)[] = [
    `${input.assistantTitle} needs a decision from you.`,
    "",
    message || null,
    message ? "" : null,
    summary ? "Conversation so far:" : null,
    summary || null,
    summary ? "" : null,
    `Review and decide: ${input.link}`,
    input.expiresAt ? `This request expires on ${new Date(input.expiresAt).toUTCString()}.` : null,
    "",
    "The first colleague to decide closes the request. You must be signed in to Ciele to answer.",
  ];
  return {
    subject: `[Review] ${input.title}`,
    body: lines.filter((line): line is string => line !== null).join("\n"),
  };
}

/** A fresh input field for the editor, with a slug id from its position. */
export function newReviewInputField(index: number): ReviewInputField {
  return { id: `input_${index + 1}`, label: "", type: "short_text", required: true };
}
