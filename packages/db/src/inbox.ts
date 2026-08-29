import type { InboxConversation, InboxQuery } from "@agent-hub/core";

export const DEFAULT_INBOX_PAGE_SIZE = 50;
export const MAX_INBOX_PAGE_SIZE = 100;

export interface InboxCursor {
  updatedAt: string;
  id: string;
}

export function inboxPageSize(limit?: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_INBOX_PAGE_SIZE;
  return Math.max(
    1,
    Math.min(Math.floor(limit as number), MAX_INBOX_PAGE_SIZE)
  );
}

export function encodeInboxCursor(cursor: InboxCursor): string {
  return encodeURIComponent(`${cursor.updatedAt}\n${cursor.id}`);
}

export function decodeInboxCursor(cursor?: string | null): InboxCursor | null {
  if (!cursor) return null;
  try {
    const [updatedAt, id, ...rest] = decodeURIComponent(cursor).split("\n");
    if (rest.length > 0 || !updatedAt || !id || Number.isNaN(Date.parse(updatedAt))) {
      return null;
    }
    return { updatedAt, id };
  } catch {
    return null;
  }
}

function contains(value: string | null | undefined, needle: string): boolean {
  return Boolean(value?.toLowerCase().includes(needle));
}

function subjectName(conversation: InboxConversation): string {
  if (conversation.metadata.userName) return conversation.metadata.userName;
  if (conversation.metadata.userEmail) {
    return conversation.metadata.userEmail.split("@")[0] ?? "";
  }
  if (conversation.metadata.ssoClaimValue) {
    return conversation.metadata.ssoClaimValue;
  }
  if (conversation.subjectType === "member") return "Member";
  return conversation.subjectType === "sso" ? "Signed-in user" : "Visitor";
}

/** Demo-adapter oracle for the filters enforced by the SQL Inbox read model. */
export function inboxConversationMatches(
  conversation: InboxConversation,
  query: InboxQuery
): boolean {
  const from = query.from ? Date.parse(`${query.from}T00:00:00.000Z`) : null;
  const to = query.to ? Date.parse(`${query.to}T23:59:59.999Z`) : null;
  const updated = Date.parse(conversation.updatedAt);
  if (from !== null && updated < from) return false;
  if (to !== null && updated > to) return false;

  const search = query.search?.trim().toLowerCase() ?? "";
  if (
    search &&
    ![
      conversation.title,
      conversation.subjectId,
      conversation.metadata.userEmail,
      conversation.metadata.userName,
      subjectName(conversation),
    ].some((value) => contains(value, search))
  ) {
    return false;
  }
  const userInfo = query.userInfo?.trim().toLowerCase() ?? "";
  if (
    userInfo &&
    ![
      conversation.subjectId,
      conversation.metadata.userEmail,
      conversation.metadata.userName,
      conversation.metadata.userRole,
    ].some((value) => contains(value, userInfo))
  ) {
    return false;
  }
  if (query.location && conversation.metadata.location !== query.location) return false;
  if (query.city && conversation.metadata.city !== query.city) return false;
  if (query.role && conversation.metadata.userRole !== query.role) return false;
  if (query.assistantId && conversation.assistantId !== query.assistantId) return false;
  if (query.language && conversation.metadata.language !== query.language) return false;
  if (query.workflow && !conversation.flowNames.includes(query.workflow)) return false;
  if (
    query.conversationIds?.length &&
    !query.conversationIds.includes(conversation.id)
  ) {
    return false;
  }
  if (query.feedback === "up" && conversation.feedback !== 1) return false;
  if (query.feedback === "down" && conversation.feedback !== -1) return false;
  if (query.escalation === "escalated" && !conversation.metadata.escalated) return false;
  if (query.escalation === "not_escalated" && conversation.metadata.escalated) return false;
  if ((query.staff ?? "") === "" && conversation.subjectType === "member") return false;
  if (query.staff === "only" && conversation.subjectType !== "member") return false;
  return true;
}

export function compareInboxConversation(
  left: Pick<InboxConversation, "updatedAt" | "id">,
  right: Pick<InboxConversation, "updatedAt" | "id">
): number {
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt > right.updatedAt ? -1 : 1;
  }
  if (left.id === right.id) return 0;
  return left.id > right.id ? -1 : 1;
}

export function isAfterInboxCursor(
  conversation: Pick<InboxConversation, "updatedAt" | "id">,
  cursor: InboxCursor
): boolean {
  return (
    conversation.updatedAt < cursor.updatedAt ||
    (conversation.updatedAt === cursor.updatedAt && conversation.id < cursor.id)
  );
}
