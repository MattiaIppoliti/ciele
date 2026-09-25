import type { Alert } from "@agent-hub/core";

/**
 * The bottom-right notification banner shows operational **alerts** read from
 * the server and **mentions** that point to unread group messages. This module
 * holds the pure projection and ordering. The banner lives in
 * `components/notifications/notification-center.tsx`.
 */

export type NotificationStatus = "success" | "error" | "warning" | "info";

/**
 * `mention` is the third stream (#778): somebody named this Member in a group.
 * Server-rendered like an alert and, like one, it does not clear itself, but it
 * is nobody else's business and it is not an operational fault, so it never
 * reaches `/alerts`. Opening the group is what clears it.
 */
export type NotificationSource = "alert" | "mention";

export interface AppNotification {
  id: string;
  status: NotificationStatus;
  title: string;
  description?: string;
  /** Small right-aligned label on the card (alert type, elapsed time, …). */
  tag?: string;
  /** Epoch ms, newest sorts first. */
  createdAt: number;
  source: NotificationSource;
}

const ALERT_STATUS: Record<Alert["type"], NotificationStatus> = {
  integration: "error",
  provider: "error",
  crawl: "warning",
  ingestion: "warning",
  // A dangling Knowledge Scope answers nothing, but it breaks no pipeline and
  // no credential: it waits for a person to decide what the scope should say.
  knowledge: "warning",
  system: "warning",
};

const ALERT_TAGS: Record<Alert["type"], string> = {
  integration: "Integration",
  provider: "AI Provider",
  crawl: "Crawl",
  ingestion: "Ingestion",
  knowledge: "Knowledge",
  system: "System",
};

/** Projects a server Alert onto the banner's notification shape. */
export function alertNotification(alert: Alert): AppNotification {
  return {
    id: `alert:${alert.id}`,
    status: ALERT_STATUS[alert.type],
    title: alert.title,
    description: alert.detail,
    tag: ALERT_TAGS[alert.type],
    createdAt: Date.parse(alert.detectedAt),
    source: "alert",
  };
}

/**
 * Somebody named this Member in a group, as one card.
 *
 * Keyed by the group and nothing else, which is the whole point: whoever named
 * you and however often, this is one card saying to go and look there. The id
 * therefore stays stable across renders, so dismissing it dismisses the group's
 * card rather than one mention inside it.
 */
export function mentionNotification(mention: {
  channelId: string;
  channelName: string;
  at: string;
}): AppNotification {
  return {
    id: `mention:${mention.channelId}`,
    status: "info",
    title: `You were mentioned in ${mention.channelName}`,
    description: "Open the group to read what was asked.",
    tag: "Group",
    createdAt: Date.parse(mention.at),
    source: "mention",
  };
}

/**
 * The cards the banner renders: newest first, dismissed ids dropped, capped at
 * `limit`. Alerts win ties because they need an operator's attention.
 */
export function visibleNotifications(
  notifications: AppNotification[],
  { limit, dismissed }: { limit: number; dismissed?: ReadonlySet<string> },
): AppNotification[] {
  return notifications
    .filter((n) => !dismissed?.has(n.id))
    .slice()
    .sort((a, b) => {
      if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
      if (a.source === b.source) return 0;
      return a.source === "alert" ? -1 : 1;
    })
    .slice(0, limit);
}
