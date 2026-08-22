import type { InboxConversation } from "@agent-hub/core";
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

/**
 * The Inbox list's whole filter behavior: date range, free-text search across
 * title/user/subject, the separate user-info search, the staff-visibility
 * default (#668), the equality filters, the id allowlist, feedback sign and
 * escalation state. The component's useMemo delegates here so each clause has
 * a test.
 */
export function filterConversations(
  conversations: InboxConversation[],
  criteria: InboxFilterCriteria
): InboxConversation[] {
  const ids = criteria.conversationIds
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const from = criteria.from ? new Date(`${criteria.from}T00:00:00`) : null;
  const to = criteria.to ? new Date(`${criteria.to}T23:59:59.999`) : null;
  const needle = criteria.search.trim().toLowerCase();
  const userNeedle = criteria.userInfo.trim().toLowerCase();

  return conversations.filter((c) => {
    const updated = new Date(c.updatedAt);
    if (from && updated < from) return false;
    if (to && updated > to) return false;
    if (
      needle &&
      ![c.title, c.metadata.userEmail, c.metadata.userName, subjectName(c)]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(needle))
    )
      return false;
    if (
      userNeedle &&
      ![c.metadata.userEmail, c.metadata.userName, c.metadata.userRole, c.subjectId]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(userNeedle))
    )
      return false;
    // Default views hide staff (member-subject) conversations (#668).
    if (criteria.staff === "" && c.subjectType === "member") return false;
    if (criteria.staff === "only" && c.subjectType !== "member") return false;
    if (criteria.location && c.metadata.location !== criteria.location) return false;
    if (criteria.city && c.metadata.city !== criteria.city) return false;
    if (criteria.role && c.metadata.userRole !== criteria.role) return false;
    if (criteria.assistantId && c.assistantId !== criteria.assistantId) return false;
    if (criteria.language && c.metadata.language !== criteria.language) return false;
    if (criteria.workflow && !c.flowNames.includes(criteria.workflow)) return false;
    if (ids.length > 0 && !ids.includes(c.id)) return false;
    if (criteria.feedback === "up" && c.feedback !== 1) return false;
    if (criteria.feedback === "down" && c.feedback !== -1) return false;
    if (criteria.escalation === "escalated" && !c.metadata.escalated) return false;
    if (criteria.escalation === "not_escalated" && c.metadata.escalated) return false;
    return true;
  });
}
