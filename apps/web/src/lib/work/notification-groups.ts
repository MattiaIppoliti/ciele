import type { MemberNotificationKind } from "@agent-hub/core";
import { addDays, taskKey } from "@agent-hub/core";
import type { NotificationItem } from "@ciele/ops";

/**
 * How the Notifications page sorts a Member's Notifications (#1067), pure so
 * it is tested: which tab holds which kinds, what a row says, and how the list
 * is grouped by age.
 */

export type NotificationTab = "all" | "mentions" | "assigned" | "comments" | "updates";

export const NOTIFICATION_TABS: { key: NotificationTab; label: string; kinds: MemberNotificationKind[] | null }[] = [
  { key: "all", label: "All", kinds: null },
  { key: "mentions", label: "Mentions", kinds: ["mentioned"] },
  { key: "assigned", label: "Assigned", kinds: ["assigned"] },
  { key: "comments", label: "Comments", kinds: ["commented"] },
  { key: "updates", label: "Updates", kinds: ["status_changed"] },
];

export function inTab(item: Pick<NotificationItem, "kind">, tab: NotificationTab): boolean {
  const kinds = NOTIFICATION_TABS.find((t) => t.key === tab)?.kinds;
  return !kinds || kinds.includes(item.kind);
}

export function notificationKey(item: Pick<NotificationItem, "project" | "task">): string {
  return taskKey(item.project.key, item.task.seq);
}

/** Who did it: the Member's name, "A Teammate", or "Someone" for a departed Member. */
export function notificationActor(item: Pick<NotificationItem, "actorName" | "actorTeammateId">): string {
  return item.actorName ?? (item.actorTeammateId ? "A Teammate" : "Someone");
}

/** "Ada assigned you WEB-12": the line a row and a card both lead with. */
export function notificationText(item: Pick<NotificationItem, "kind" | "actorName" | "actorTeammateId" | "project" | "task">): string {
  const who = notificationActor(item);
  const key = notificationKey(item);
  switch (item.kind) {
    case "assigned":
      return `${who} assigned you ${key}`;
    case "mentioned":
      return `${who} mentioned you on ${key}`;
    case "commented":
      return `${who} commented on ${key}`;
    case "status_changed":
      return `${who} changed the status of ${key}`;
  }
}

export type AgeGroup = "Today" | "Yesterday" | "This week" | "Earlier";

/** Newest first, grouped Today / Yesterday / This week / Earlier by UTC day. */
export function groupByAge<T extends { createdAt: string }>(items: readonly T[], today: string): { title: AgeGroup; items: T[] }[] {
  const yesterday = addDays(today, -1);
  const weekAgo = addDays(today, -7);
  const bucket = (createdAt: string): AgeGroup => {
    const d = createdAt.slice(0, 10);
    if (d >= today) return "Today";
    if (d === yesterday) return "Yesterday";
    if (d > weekAgo) return "This week";
    return "Earlier";
  };
  const order: AgeGroup[] = ["Today", "Yesterday", "This week", "Earlier"];
  const groups = new Map<AgeGroup, T[]>();
  for (const item of [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const title = bucket(item.createdAt);
    groups.set(title, [...(groups.get(title) ?? []), item]);
  }
  return order.filter((title) => groups.has(title)).map((title) => ({ title, items: groups.get(title)! }));
}
