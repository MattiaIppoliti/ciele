import type { Improvement, ImprovementStatus } from "./types";

/** Member-owned workflow; a status records a decision, never proof of deployment. */
export const IMPROVEMENT_WORKFLOW = {
  to_do: {
    label: "Triage",
    guidance: "Review the flagged answers, describe the expected answer, and assign an owner.",
    next: "in_progress",
    action: "Start fixing",
  },
  in_progress: {
    label: "Fix",
    guidance: "Correct the knowledge, Flow, or instructions responsible for the answer gap.",
    next: "in_review",
    action: "Ready to validate",
  },
  in_review: {
    label: "Validate",
    guidance: "Replay the original question in Preview, check its Sources, and confirm the customer widget uses the fix.",
    next: "done",
    action: "Mark resolved",
  },
  done: {
    label: "Resolved",
    guidance: "The owner marked this answer gap resolved. This status is not an automated test or deployment result.",
    next: null,
    action: null,
  },
  archived: {
    label: "Archived",
    guidance: "This item is retained for reference and is outside the active improvement workflow.",
    next: null,
    action: null,
  },
} satisfies Record<ImprovementStatus, {
  label: string;
  guidance: string;
  next: ImprovementStatus | null;
  action: string | null;
}>;

/**
 * An Improvement is open while it is neither done nor archived.
 *
 * A closed item is a solved problem, so a recurrence deserves a fresh item
 * rather than silently reopening history. The rule lived inline in two dedup
 * walks before it lived here; a pure function of a domain type belongs in the
 * domain package (ADR-0019).
 */
export function isOpenImprovement(improvement: Pick<Improvement, "status">): boolean {
  return improvement.status !== "done" && improvement.status !== "archived";
}
