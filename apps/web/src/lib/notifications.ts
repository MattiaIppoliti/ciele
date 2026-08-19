import type { Alert } from "@agent-hub/core";

/**
 * The bottom-right notification banner shows two kinds of thing: operational
 * **alerts** read from the server (they persist until resolved) and transient
 * **events** raised by the UI itself, "Published v3", "Upload failed". This
 * module holds the pure part: the shape, the ordering, and the auto-dismiss
 * policy. The React store and the banner live in
 * `components/notifications/notification-center.tsx`.
 */

export type NotificationStatus = "success" | "error" | "warning" | "info";

export type NotificationSource = "alert" | "event";

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

/** How long a self-clearing event stays up before it fades on its own. */
export const AUTO_DISMISS_MS = 6_000;

/**
 * Successes and neutral notices clear themselves; anything the user may need
 * to act on (errors, warnings, alerts) waits to be dismissed or resolved.
 */
export function autoDismisses(notification: AppNotification): boolean {
  if (notification.source === "alert") return false;
  return notification.status === "success" || notification.status === "info";
}

const ALERT_STATUS: Record<Alert["type"], NotificationStatus> = {
  integration: "error",
  provider: "error",
  crawl: "warning",
  ingestion: "warning",
  system: "warning",
};

const ALERT_TAGS: Record<Alert["type"], string> = {
  integration: "Integration",
  provider: "AI Provider",
  crawl: "Crawl",
  ingestion: "Ingestion",
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
 * The cards the banner renders: newest first, dismissed ids dropped, capped at
 * `limit`. Events outrank alerts at equal timestamps, a result the user just
 * caused is what they are looking for.
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
      return a.source === "event" ? -1 : 1;
    })
    .slice(0, limit);
}
