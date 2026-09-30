"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Alert } from "@agent-hub/core";
import type { ChannelMention } from "@ciele/ops";
import { useFeedback } from "@agent-hub/ui/feedback";
import { NotificationStack } from "@/components/motion/notification-stack";
import {
  alertNotification,
  mentionNotification,
  visibleNotifications,
} from "@/lib/notifications";
import { formatCount } from "@/lib/format";

/** Cards the banner shows at once; the rest wait behind the count badge. */
const VISIBLE_LIMIT = 3;

/**
 * The admin shell's bottom-right notification banner. It merges two streams:
 *
 * - **Alerts** rendered on the server (operational health), they stay until an
 *   admin resolves them, and clicking through opens `/alerts`.
 * - **Mentions** that point to a group where this Member was named.
 *
 * Alert cards step aside on `/alerts` itself (the page already lists them).
 */
export function NotificationCenter({
  alerts,
  totalAlertCount,
  mentions = [],
}: {
  alerts: Alert[];
  totalAlertCount: number;
  /**
   * Groups where this Member was named and has not read it (#778): one card
   * each, never one per mention. Like the alerts these are server-rendered and
   * persist, but they step aside inside the group they point at, where the
   * transcript is the notification.
   */
  mentions?: ChannelMention[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // A new Alert or mention *arriving* while the page is open gets one `chime`
  // (#817). The initial render is not an arrival, and neither is a re-render
  // that carries the same ids, so the set of seen ids is the whole rule.
  const { play } = useFeedback();
  const seen = useRef<Set<string> | null>(null);
  // The chime is not heard by everyone; this is what a screen reader hears.
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const ids = [
      ...alerts.map((alert) => `alert:${alert.id}`),
      // One card per group, so a *new* mention in an already-mentioned group
      // shows as the same card with a newer `at`; the key carries it.
      ...mentions.map((mention) => `mention:${mention.channelId}:${mention.at}`),
    ];
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const fresh = ids.filter((id) => !seen.current!.has(id));
    seen.current = new Set(ids);
    if (fresh.length === 0) return;
    play("arrive");
    setAnnouncement(
      arrivalAnnouncement({
        alertCount: fresh.some((id) => id.startsWith("alert:"))
          ? totalAlertCount
          : 0,
        mentionCount: fresh.filter((id) => id.startsWith("mention:")).length,
      }),
    );
  }, [alerts, mentions, play, totalAlertCount]);

  const onAlertsPage = pathname.startsWith("/alerts");

  const items = useMemo(() => {
    const alertItems = onAlertsPage ? [] : alerts.map(alertNotification);
    // A card pointing at the group you are already reading is noise, and the
    // read marker is about to clear it anyway.
    const mentionItems = mentions
      .filter(
        (mention) => !pathname.startsWith(`/teammates/channels/${mention.channelId}`)
      )
      .map(mentionNotification);
    return visibleNotifications([...alertItems, ...mentionItems], {
      limit: VISIBLE_LIMIT,
      dismissed,
    });
  }, [alerts, mentions, dismissed, onAlertsPage, pathname]);

  // Mounted before anything arrives: a live region that appears together with
  // its text is not announced.
  const liveRegion = (
    <p role="status" aria-live="polite" className="sr-only">
      {announcement}
    </p>
  );

  if (items.length === 0) return liveRegion;

  const shownAlerts = items.filter((item) => item.source === "alert").length;
  const hiddenAlerts = onAlertsPage ? 0 : totalAlertCount - shownAlerts;

  const closeAll = () => {
    setDismissed((current) => {
      const next = new Set(current);
      for (const item of items) next.add(item.id);
      return next;
    });
  };

  return (
    // The dock owns the corner and the right-rail offset (see
    // `notification-dock.tsx`); this is one occupant of it, so all it does here
    // is hold the stack's own width. It still floats over the workspace, hence
    // pointer-events-auto on the stack itself.
    <div className="flex w-full justify-end">
      {liveRegion}
      <NotificationStack
        items={items.map((item) => ({
          id: item.id,
          status: item.status,
          title: item.title,
          description: item.description,
          trailing: item.tag,
        }))}
        collapsedLabel={collapsedLabel(
          shownAlerts + hiddenAlerts,
          items.length,
        )}
        expandedLabel={
          shownAlerts > 0
            ? hiddenAlerts > 0
              ? `View all ${totalAlertCount}`
              : "View all"
            : "Dismiss"
        }
        onViewAll={shownAlerts > 0 ? () => router.push("/alerts") : closeAll}
        // A real link under the pointer, so Cmd-click and middle-click open
        // the Alerts page in a new tab. The keyboard keeps `onViewAll`.
        viewAllHref={shownAlerts > 0 ? "/alerts" : undefined}
        onClose={closeAll}
        className="pointer-events-auto shadow-strong"
      />
    </div>
  );
}

/** The count badge next to this label already carries the number. */
function collapsedLabel(alertCount: number, itemCount: number): string {
  if (alertCount === 1) return "alert needs attention";
  if (alertCount > 1) return "alerts need attention";
  return itemCount === 1 ? "notification" : "notifications";
}

/** "2 alerts need attention. 1 new mention", for the polite live region. */
function arrivalAnnouncement({
  alertCount,
  mentionCount,
}: {
  alertCount: number;
  mentionCount: number;
}): string {
  const parts: string[] = [];
  if (alertCount > 0) {
    parts.push(
      alertCount === 1
        ? "1 alert needs attention"
        : `${formatCount(alertCount)} alerts need attention`,
    );
  }
  if (mentionCount > 0) {
    parts.push(
      mentionCount === 1
        ? "1 new mention"
        : `${formatCount(mentionCount)} new mentions`,
    );
  }
  return parts.join(". ");
}
