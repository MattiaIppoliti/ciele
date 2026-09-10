import type { ReviewStatus } from "@agent-hub/core";

/**
 * How a Human review's status reads (#841), in one place. Five surfaces show
 * it (the console transcript, the Inbox transcript and detail rail, the
 * decision page, the published widget) and each used to spell the cascade out
 * itself; a status added to `ReviewStatus` would have had to find all five.
 */

/** The one-word status: "Pending", "Approved", "Rejected", "Expired". */
export function reviewStatusLabel(status: ReviewStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "expired":
      return "Expired";
  }
}

/**
 * The status with who decided it: "Approved by Dana", or the bare label when
 * nobody has (a pending or an expired request names no one).
 */
export function reviewDecisionLabel(
  review: { status: ReviewStatus; decidedByName?: string | null }
): string {
  const by = review.decidedByName ? ` by ${review.decidedByName}` : "";
  return `${reviewStatusLabel(review.status)}${by}`;
}

/**
 * The widget's wording. A Visitor is told what happened to their request, not
 * handed an operator's status word: "Reviewed and not approved." rather than
 * "Rejected".
 */
export function reviewStatusSentence(status: ReviewStatus): string {
  switch (status) {
    case "pending":
      return "Waiting for a colleague to review this.";
    case "approved":
      return "Reviewed and approved.";
    case "rejected":
      return "Reviewed and not approved.";
    case "expired":
      return "The review request expired.";
  }
}
