import type { InboxConversation, InboxQuery } from "@agent-hub/core";
import { isoDay } from "@agent-hub/core";

export interface InboxFilters {
  userInfo: string;
  location: string;
  city: string;
  role: string;
  from: string;
  to: string;
  assistantId: string;
  language: string;
  workflow: string;
  conversationIds: string;
  feedback: "" | "up" | "down";
  escalation: "" | "escalated" | "not_escalated";
  /**
   * Staff (member-subject) conversations, admin Preview, the data
   * assistant, are hidden by default (#668); "include" opts them in.
   */
  staff: "" | "include" | "only";
  /** Human review (#841): only Conversations waiting on a decision. */
  review: "" | "pending";
}

/** The Inbox opens on the last 30 days with everything else wide open. */
export function defaultInboxFilters(): InboxFilters {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    userInfo: "",
    location: "",
    city: "",
    role: "",
    from: isoDay(from),
    to: isoDay(to),
    assistantId: "",
    language: "",
    workflow: "",
    conversationIds: "",
    feedback: "",
    escalation: "",
    staff: "",
    review: "",
  };
}

export function subjectName(c: InboxConversation): string {
  if (c.metadata.userName) return c.metadata.userName;
  if (c.metadata.userEmail) return c.metadata.userEmail.split("@")[0];
  if (c.metadata.ssoClaimValue) return c.metadata.ssoClaimValue;
  if (c.subjectType === "member") return "Member";
  return c.subjectType === "sso" ? "Signed-in user" : "Visitor";
}

/**
 * Everything the list is narrowed by. The toolbar's free-text `search` is its
 * own component state (Reset clears the panel's filters and leaves the search
 * box alone), but it is a filter criterion like any other, so it travels with
 * them rather than as a second positional argument.
 */
export interface InboxFilterCriteria extends InboxFilters {
  search: string;
}

/** Convert the toolbar state into the database-owned Inbox read contract. */
export function inboxQueryFromFilters(
  criteria: InboxFilterCriteria,
  page: Pick<InboxQuery, "cursor" | "limit"> = {}
): InboxQuery {
  const text = (value: string) => value.trim() || undefined;
  const conversationIds = criteria.conversationIds
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  return {
    ...page,
    search: text(criteria.search),
    userInfo: text(criteria.userInfo),
    location: text(criteria.location),
    city: text(criteria.city),
    role: text(criteria.role),
    from: text(criteria.from),
    to: text(criteria.to),
    assistantId: text(criteria.assistantId),
    language: text(criteria.language),
    workflow: text(criteria.workflow),
    conversationIds: conversationIds.length > 0 ? conversationIds : undefined,
    feedback: criteria.feedback || undefined,
    escalation: criteria.escalation || undefined,
    staff: criteria.staff,
  };
}
