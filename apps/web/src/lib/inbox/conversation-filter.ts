import type { InboxConversation, InboxQuery } from "@agent-hub/core";
import { isoDay } from "@agent-hub/core";
import { filtersFromSearchParams } from "@/lib/url-state";

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
  feedback: "" | "up" | "down" | "neutral";
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

/** The typed filters' legal values, so a hand-edited link cannot widen them. */
const INBOX_FILTER_OPTIONS = {
  feedback: ["", "up", "down", "neutral"],
  escalation: ["", "escalated", "not_escalated"],
  staff: ["", "include", "only"],
  review: ["", "pending"],
} as const;

/** Filters and search as the address bar keeps them; `q` is the search box. */
export type InboxUrlState = InboxFilters & { q: string };

export function defaultInboxUrlState(): InboxUrlState {
  return { ...defaultInboxFilters(), q: "" };
}

/** The Inbox view a URL asks for, anything missing or invalid at its default. */
export function inboxUrlStateFromSearchParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): InboxUrlState {
  return filtersFromSearchParams(params, defaultInboxUrlState(), INBOX_FILTER_OPTIONS);
}

export function subjectName(c: Pick<InboxConversation, "metadata" | "subjectType">): string {
  if (c.metadata.userName) return c.metadata.userName;
  if (c.metadata.userEmail) return c.metadata.userEmail.split("@")[0];
  if (c.metadata.ssoClaimValue) return c.metadata.ssoClaimValue;
  // A question an API key asked (`assistants.ask`) shares the Preview's
  // subject, the Member the key delegates for; the key is what tells them apart.
  if (c.subjectType === "member") return c.metadata.apiKeyId ? "API key" : "Member";
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
