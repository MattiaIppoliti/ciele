import type {
  TeammateCapabilityCeiling,
  TeammateGrantDomain,
} from "@agent-hub/core";

/**
 * What the grants panel says (#770).
 *
 * Copy in a `.ts` module rather than inline in the `.tsx`, because this app's
 * vitest ignores `.tsx` and the sentence a Member reads before handing an agent
 * write access to their knowledge base is worth a test. The rules it describes
 * live in `@agent-hub/core`; nothing here decides anything.
 */

export interface GrantDomainCopy {
  domain: TeammateGrantDomain;
  label: string;
  /** What granting it buys, in the terms a Member already uses for the console. */
  detail: string;
}

export const GRANT_DOMAIN_COPY: readonly GrantDomainCopy[] = [
  {
    domain: "improvements",
    label: "Improvements",
    detail:
      "Read the board, move items, and draft Suggested Fixes for flagged answers.",
  },
  {
    domain: "knowledge",
    label: "Knowledge",
    detail: "Read the Library and add or correct FAQs. It never deletes a Source.",
  },
  {
    domain: "inbox",
    label: "Inbox",
    detail: "Read visitor conversations and pin them. It never deletes one.",
  },
];

export interface CeilingCopy {
  ceiling: TeammateCapabilityCeiling;
  label: string;
  detail: string;
}

export const CEILING_COPY: readonly CeilingCopy[] = [
  {
    ceiling: "member",
    label: "Read only",
    detail: "It can look at everything you granted, and change none of it.",
  },
  {
    ceiling: "edit",
    label: "Read and change",
    detail: "The default. It can change things inside what you granted.",
  },
];

/**
 * One line under the panel heading, so the state is legible without reading the
 * checkboxes back. The ungranted case is the one that matters: "can only talk"
 * is the honest description of a Teammate with no rows, and a Member should be
 * able to see that at a glance rather than infer it from three empty boxes.
 */
export function grantSummary(
  domains: readonly TeammateGrantDomain[],
  ceiling: TeammateCapabilityCeiling,
  approvalBypass: boolean
): string {
  if (domains.length === 0) {
    return "This teammate can only talk. It cannot change anything in the console.";
  }
  const labels = GRANT_DOMAIN_COPY.filter((copy) =>
    domains.includes(copy.domain)
  ).map((copy) => copy.label.toLowerCase());
  const list =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  const verb = ceiling === "member" ? "can read" : "can act in";
  const bypass =
    approvalBypass && domains.includes("knowledge")
      ? " It can also accept its own Suggested Fixes without anyone reviewing them."
      : "";
  return `This teammate ${verb} ${list}.${bypass}`;
}

/**
 * Why the bypass switch is off and unavailable, or null when it is offered.
 *
 * Stated rather than merely disabled: a switch that does nothing with no
 * explanation reads as broken, and this one is refusing for a real reason.
 */
export function bypassBlockedReason(
  domains: readonly TeammateGrantDomain[]
): string | null {
  if (!domains.includes("knowledge")) {
    return "Grant Knowledge first: accepting a Suggested Fix writes a FAQ into your knowledge.";
  }
  if (!domains.includes("improvements")) {
    return "Grant Improvements first: Suggested Fixes live on the improvements board.";
  }
  return null;
}
